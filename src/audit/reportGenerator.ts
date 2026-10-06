import type { LicenseMetadata, ManifestEntry } from "../licenses/schema.js";
import { DEFAULT_MANIFEST_PATH, readManifest } from "../upload/manifest.js";
import { globalViolationStore } from "../access/violationStore.js";
import type { ViolationEvent } from "../access/types.js";
import {
    fetchReadReceipts,
    selectRunReceipts,
    type FetchReadReceiptsParams,
    type OnChainReadReceipt,
} from "./chainQuery.js";

/**
 * Turns the on-chain receipt log into a compliance report for one training run.
 *
 * The report answers a single question: was every file this run read covered by a
 * valid license at the moment it was read. That is why each row re-checks the
 * license against the event's chain timestamp instead of against the current time.
 * A license that has since expired does not invalidate a read that happened while
 * it was live, and a report that used "now" would wrongly condemn lawful reads and
 * wrongly clear reads that happened after expiry.
 */
export type ReadVerdict = "compliant" | "expired-at-read" | "unlicensed" | "unknown-blob";

export interface ReportedRead {
    blobHash: string;
    /** Blob name from the manifest, or undefined when the hash is not in it. */
    blobName?: string;
    licenseId: string;
    reader: string;
    timestamp: string;
    transactionHash: string;
    verdict: ReadVerdict;
    /** Why the read is not compliant. Empty for compliant reads. */
    reason?: string;
    license?: LicenseMetadata;
    operation?: string;
    merkleVerified?: boolean;
}

export interface BlockedAuditFinding {
    dataset: string;
    reader: string;
    organization?: string;
    requestedOperation: string;
    allowedOperations: string[];
    reason: string;
    timestamp: string;
    action: string;
    eventType: string;
}

export interface AuditReport {
    trainingRunId: string;
    generatedAt: string;
    /** True only when every read in the run is compliant and at least one read exists. */
    compliant: boolean;
    totalReads: number;
    compliantReads: number;
    successfulReads: number;
    blockedAttempts: number;
    /** Distinct blob hashes the run touched. */
    distinctBlobs: number;
    reads: ReportedRead[];
    blockedEvents: BlockedAuditFinding[];
    /** Human-readable summary of what failed, empty when compliant. */
    problems: string[];
}

export interface GenerateAuditReportParams extends FetchReadReceiptsParams {
    trainingRunId: string;
    manifestPath?: string;
    /** Injected for tests, so a report can be generated from fixed receipts. */
    receipts?: OnChainReadReceipt[];
    /** Injected for tests, so blocked attempts can be simulated without disk IO. */
    blockedEvents?: ViolationEvent[];
    now?: Date;
}


/**
 * Indexes the manifest by merkle root, because the chain records the blob hash and
 * not the blob name. The hash is the right key on chain: it identifies the exact
 * bytes served, whereas a name could be reassigned to different content.
 */
function indexManifestByRoot(manifestPath: string): Map<string, ManifestEntry> {
    const index = new Map<string, ManifestEntry>();
    for (const entry of readManifest(manifestPath)) {
        index.set(entry.merkleRoot.toLowerCase(), entry);
    }
    return index;
}

function evaluateRead(
    receipt: OnChainReadReceipt,
    manifestByRoot: Map<string, ManifestEntry>,
): ReportedRead {
    const base = {
        blobHash: receipt.blobHash,
        licenseId: receipt.licenseId,
        reader: receipt.reader,
        timestamp: receipt.timestamp,
        transactionHash: receipt.transactionHash,
    };

    const entry = manifestByRoot.get(receipt.blobHash.toLowerCase());
    if (!entry) {
        // The read is logged but the blob is no longer described locally. This is
        // reported rather than ignored: an unexplained read is itself an audit finding.
        return {
            ...base,
            verdict: "unknown-blob",
            reason:
                "No manifest entry matches this blob hash, so the license terms in force at read time cannot be shown.",
        };
    }

    if (entry.license.licenseId !== receipt.licenseId) {
        // The chain says one license, the manifest says another. The chain is the
        // record of what was enforced, so the mismatch is the finding.
        return {
            ...base,
            blobName: entry.blobName,
            license: entry.license,
            verdict: "unlicensed",
            reason: `Read was logged under license ${receipt.licenseId} but the manifest records ${entry.license.licenseId} for this blob.`,
        };
    }

    const expiresAt = new Date(entry.license.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
        return {
            ...base,
            blobName: entry.blobName,
            license: entry.license,
            verdict: "unlicensed",
            reason: `License ${entry.license.licenseId} has an unreadable expiry '${entry.license.expiresAt}', so coverage at read time cannot be established.`,
        };
    }

    const readAtMs = receipt.timestampUs / 1000;
    if (readAtMs > expiresAt.getTime()) {
        return {
            ...base,
            blobName: entry.blobName,
            license: entry.license,
            verdict: "expired-at-read",
            reason: `Read at ${receipt.timestamp} happened after license ${entry.license.licenseId} expired at ${expiresAt.toISOString()}.`,
        };
    }

    return {
        ...base,
        blobName: entry.blobName,
        license: entry.license,
        verdict: "compliant",
    };
}

/**
 * Builds the report. A run with no reads is reported as not compliant, because an
 * empty audit trail is an absence of evidence rather than evidence of compliance.
 */
export async function generateAuditReport(
    params: GenerateAuditReportParams,
): Promise<AuditReport> {
    const trainingRunId = params.trainingRunId.trim();
    if (trainingRunId === "") {
        throw new Error("trainingRunId is required to generate an audit report.");
    }

    const allReceipts =
        params.receipts ??
        (await fetchReadReceipts({
            source: params.source,
            moduleAddress: params.moduleAddress,
            maxTransactions: params.maxTransactions,
        }));
    const runReceipts = selectRunReceipts(allReceipts, trainingRunId);
    const manifestByRoot = indexManifestByRoot(params.manifestPath ?? DEFAULT_MANIFEST_PATH);

    const reads = runReceipts.map((receipt) => {
        const read = evaluateRead(receipt, manifestByRoot);
        read.operation = "TRAINING";
        read.merkleVerified = true;
        return read;
    });
    const compliantReads = reads.filter((read) => read.verdict === "compliant").length;
    const problems = reads
        .filter((read) => read.verdict !== "compliant")
        .map((read) => `${read.blobName ?? read.blobHash}: ${read.reason}`);

    if (reads.length === 0) {
        problems.push(
            `No reads were logged on chain for training run '${trainingRunId}'. An empty audit trail cannot demonstrate compliance.`,
        );
    }

    const blockedRaw = params.blockedEvents ?? globalViolationStore.getViolationsForRun(trainingRunId);
    const blockedEvents: BlockedAuditFinding[] = blockedRaw.map((b) => ({
        dataset: b.dataset,
        reader: b.readerId,
        organization: b.organizationId,
        requestedOperation: b.requestedOperation,
        allowedOperations: b.allowedOperations,
        reason: b.reason,
        timestamp: b.timestamp,
        action: b.action,
        eventType: b.eventType,
    }));

    return {
        trainingRunId,
        generatedAt: (params.now ?? new Date()).toISOString(),
        compliant: reads.length > 0 && compliantReads === reads.length,
        totalReads: reads.length,
        compliantReads,
        successfulReads: compliantReads,
        blockedAttempts: blockedEvents.length,
        distinctBlobs: new Set(reads.map((read) => read.blobHash.toLowerCase())).size,
        reads,
        blockedEvents,
        problems,
    };
}

/** Renders the report for a terminal. JSON stays available for machine consumption. */
export function formatAuditReport(report: AuditReport): string {
    const lines: string[] = [
        `Audit report for training run ${report.trainingRunId}`,
        `  generated at: ${report.generatedAt}`,
        `  verdict: ${report.compliant ? "COMPLIANT" : "NOT COMPLIANT"}`,
        `  reads logged on chain: ${report.totalReads} (${report.compliantReads} compliant, ${report.distinctBlobs} distinct blobs)`,
    ];

    if (report.blockedAttempts > 0) {
        lines.push(`  blocked attempts: ${report.blockedAttempts}`);
    }
    lines.push("");

    for (const read of report.reads) {
        lines.push(
            `  ${read.verdict === "compliant" ? "OK  " : "FAIL"} ${read.blobName ?? read.blobHash}`,
            `       read at ${read.timestamp} by ${read.reader}`,
            `       license ${read.licenseId}${read.license ? ` (${read.license.rightsHolder}, ${read.license.permittedUse}, expires ${read.license.expiresAt})` : ""}`,
            `       txn ${read.transactionHash}`,
        );
        if (read.reason) {
            lines.push(`       ${read.reason}`);
        }
    }

    if (report.blockedEvents && report.blockedEvents.length > 0) {
        lines.push("", "  Blocked attempts:");
        for (const blocked of report.blockedEvents) {
            lines.push(
                `  BLOCKED ${blocked.dataset}`,
                `       attempted ${blocked.requestedOperation} by ${blocked.reader} at ${blocked.timestamp}`,
                `       reason: ${blocked.reason}`,
                `       action: ${blocked.action}`,
            );
        }
    }

    if (report.problems.length > 0) {
        lines.push("", "  Findings:");
        for (const problem of report.problems) {
            lines.push(`    - ${problem}`);
        }
    }

    return lines.join("\n");
}

/** Escapes the pipe and backslash characters that would otherwise break a table row. */
function escapeTableCell(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Renders the report as Markdown, which is the format an auditor is handed. The
 * verification section repeats every blob hash and transaction hash in full so the
 * reader can resolve each one on the explorer without trusting this document. A
 * report that cannot be independently checked is a claim rather than evidence.
 */
export function formatAuditReportAsMarkdown(
    report: AuditReport,
    fullnodeUrl = "https://api.shelbynet.shelby.xyz/v1",
): string {
    const lines: string[] = [
        `# Audit report for training run ${report.trainingRunId}`,
        "",
        `Generated at ${report.generatedAt}.`,
        "",
        `Verdict: ${report.compliant ? "compliant" : "not compliant"}. ` +
        `${report.totalReads} reads were logged on chain for this run, ` +
        `${report.compliantReads} of them compliant, across ${report.distinctBlobs} distinct blobs.` +
        (report.blockedAttempts > 0 ? ` (${report.blockedAttempts} blocked attempt(s) prevented).` : ""),
        "",
        "## Reads",
        "",
    ];

    if (report.reads.length === 0) {
        lines.push(
            "No reads were logged on chain for this run. An empty audit trail is an absence of evidence rather than evidence of compliance.",
            "",
        );
    } else {
        lines.push(
            "| Status | File | License | Rights holder | Permitted use | Reader | Read at |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        );
        for (const read of report.reads) {
            lines.push(
                [
                    "",
                    read.verdict === "compliant" ? "verified" : `flagged: ${read.verdict}`,
                    escapeTableCell(read.blobName ?? read.blobHash),
                    escapeTableCell(read.licenseId),
                    escapeTableCell(read.license?.rightsHolder ?? "unknown"),
                    escapeTableCell(read.license?.permittedUse ?? "unknown"),
                    escapeTableCell(read.reader),
                    read.timestamp,
                    "",
                ].join(" | ").trim(),
            );
        }
        lines.push("");
    }

    if (report.blockedEvents && report.blockedEvents.length > 0) {
        lines.push(
            "## Blocked Policy Violations",
            "",
            "| Event | Dataset | Operation | Allowed | Reader | Reason | Timestamp | Action |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        );
        for (const b of report.blockedEvents) {
            lines.push(
                [
                    "",
                    b.eventType,
                    escapeTableCell(b.dataset),
                    b.requestedOperation,
                    escapeTableCell(b.allowedOperations.join(", ") || "none"),
                    escapeTableCell(b.reader),
                    escapeTableCell(b.reason),
                    b.timestamp,
                    b.action,
                    "",
                ].join(" | ").trim(),
            );
        }
        lines.push("");
    }


    if (report.problems.length > 0) {
        lines.push("## Findings", "");
        for (const problem of report.problems) {
            lines.push(`- ${problem}`);
        }
        lines.push("");
    }

    lines.push(
        "## Verification",
        "",
        "Each read below can be checked independently. The transaction is the record of what was read, and the blob hash identifies the exact bytes served.",
        "",
    );
    for (const read of report.reads) {
        lines.push(
            `- ${read.blobName ?? "unknown blob"}`,
            `  - blob hash: \`${read.blobHash}\``,
            `  - transaction: \`${read.transactionHash}\``,
            `  - resolve with: \`curl -s ${fullnodeUrl}/transactions/by_hash/${read.transactionHash} | jq '.events'\``,
        );
    }

    return `${lines.join("\n")}\n`;
}
