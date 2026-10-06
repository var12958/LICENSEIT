import { createHash, randomUUID } from "node:crypto";
import {
    type BlobDownloader,
    type ReceiptLogWriter,
    createShelbyDownloader,
    type ReadReceipt,
    type ReadEvent,
} from "../read/receiptMiddleware.js";
import { computeMerkleRoot } from "../read/receiptMiddleware.js";
import { logReadOnChain } from "../audit/chainWriter.js";
import { DEFAULT_MANIFEST_PATH, findManifestEntry, readManifest } from "../upload/manifest.js";
import type { LicenseMetadata, ManifestEntry, PermittedOperation } from "../licenses/schema.js";
import type {
    AccountStatus,
    ControlledAccessDenied,
    ControlledAccessRequest,
    ControlledAccessResponse,
    ControlledAccessSuccess,
    ViolationEvent,
    ViolationEventType,
} from "./types.js";
import { AccountStore, globalAccountStore } from "./accountStore.js";
import { ViolationStore, globalViolationStore } from "./violationStore.js";

export class AccessDeniedError extends Error {
    readonly violation: ViolationEvent;
    readonly eventType: ViolationEventType;
    readonly accountStatus: AccountStatus;
    readonly violationCount: number;

    constructor(violation: ViolationEvent, accountStatus: AccountStatus, violationCount: number) {
        super(violation.reason);
        this.name = "AccessDeniedError";
        this.violation = violation;
        this.eventType = violation.eventType;
        this.accountStatus = accountStatus;
        this.violationCount = violationCount;
    }
}

export interface PolicyEngineDependencies {
    manifestPath?: string;
    accountStore?: AccountStore;
    violationStore?: ViolationStore;
    downloader?: BlobDownloader;
    receiptLogWriter?: ReceiptLogWriter;
    now?: Date;
}

const defaultAptosReceiptLogWriter: ReceiptLogWriter = {
    logRead: (event) => logReadOnChain({ event }),
};

export function normalizePermittedOperations(license: LicenseMetadata): string[] {
    if (Array.isArray(license.permittedOperations) && license.permittedOperations.length > 0) {
        const ops = license.permittedOperations.map((op) => String(op).toUpperCase());
        if (ops.includes("BOTH")) {
            return ["TRAINING", "INFERENCE"];
        }
        return ops;
    }
    const legacy = (license.permittedUse ?? "training").toUpperCase();
    return [legacy];
}

export function isOperationAllowed(requestedOp: string, allowedOps: string[]): boolean {
    const req = requestedOp.toUpperCase();
    if (allowedOps.includes("BOTH") || (allowedOps.includes("TRAINING") && allowedOps.includes("INFERENCE"))) {
        return req === "TRAINING" || req === "INFERENCE";
    }
    return allowedOps.includes(req);
}

/**
 * Executes the active license policy enforcement pipeline.
 *
 * Open-access / License-governed sequence:
 * 1. Find dataset by registered blob/Merkle mapping.
 * 2. Find associated license.
 * 3. Check license start date.
 * 4. Check license expiration.
 * 5. Check requested operation (TRAINING vs INFERENCE).
 * 6. Check account/user access status (if locked by violation policy).
 * 7. Retrieve the dataset from Shelby.
 * 8. Recompute/verify the Merkle root.
 * 9. Ensure it matches the registered root.
 * 10. Create the Aptos receipt.
 * 11. Only after successful Aptos confirmation return dataset.
 *
 * FAIL-CLOSED: Data is NEVER served if any check fails.
 */
export async function evaluateAccessRequest(
    request: ControlledAccessRequest,
    deps: PolicyEngineDependencies = {},
): Promise<ControlledAccessSuccess> {
    const blobName = request.blobName;
    const readerId = (request.readerId?.trim()) || "anonymous-reader";
    const organizationId = request.organizationId?.trim() || undefined;
    const trainingRunId = request.trainingRunId;
    const operation = request.operation;

    const now = request.now ?? deps.now ?? new Date();
    const manifestPath = deps.manifestPath ?? DEFAULT_MANIFEST_PATH;
    const accountStore = deps.accountStore ?? globalAccountStore;
    const violationStore = deps.violationStore ?? globalViolationStore;
    const downloader = deps.downloader ?? createShelbyDownloader();
    const receiptLogWriter = deps.receiptLogWriter ?? defaultAptosReceiptLogWriter;

    const requestedOp = (operation ?? "TRAINING").trim().toUpperCase();

    // Helper to log denial, update account, record in store, and throw AccessDeniedError
    function deny(
        eventType: ViolationEventType,
        reason: string,
        context: {
            licenseId?: string;
            blobHash?: string;
            allowedOperations?: string[];
            license?: LicenseMetadata;
        } = {},
    ): never {
        const allowedOperations = context.allowedOperations ?? [];
        const policyConfig = context.license?.violationPolicy;

        const { action, statusAfter, violationCount } = accountStore.recordViolation(
            readerId,
            eventType,
            reason,
            organizationId,
            policyConfig,
        );

        const violation: ViolationEvent = {
            id: randomUUID(),
            eventType,
            dataset: blobName,
            blobHash: context.blobHash,
            licenseId: context.licenseId,
            readerId,
            organizationId,
            trainingRunId: trainingRunId ?? "unknown-run",
            requestedOperation: requestedOp,
            allowedOperations,
            timestamp: now.toISOString(),
            action,
            reason,
            accountStatusAfter: statusAfter,
        };

        violationStore.recordViolation(violation);
        violationStore.recordAccess({
            id: randomUUID(),
            timestamp: now.toISOString(),
            dataset: blobName,
            blobHash: context.blobHash,
            licenseId: context.licenseId,
            readerId,
            organizationId,
            trainingRunId: trainingRunId ?? "unknown-run",
            operation: requestedOp,
            allowedOperations,
            status: "BLOCKED",
            verdict: eventType,
            reason,
            actionTaken: action,
        });

        throw new AccessDeniedError(violation, statusAfter, violationCount);
    }

    if (!trainingRunId || trainingRunId.trim() === "") {
        throw new Error("trainingRunId is required for controlled access.");
    }
    if (!blobName || blobName.trim() === "") {
        throw new Error("blobName is required for controlled access.");
    }

    // 1. Find dataset by registered blob/Merkle mapping
    const entry = findManifestEntry(blobName, manifestPath);
    if (!entry) {
        deny(
            "UNKNOWN_DATASET",
            `Blob '${blobName}' has no registered manifest entry and cannot be served.`,
        );
    }

    // 2. Find associated license
    const license = entry.license;
    if (!license || !license.licenseId) {
        deny(
            "INVALID_LICENSE",
            `Dataset '${blobName}' has an invalid or missing license metadata specification.`,
            { blobHash: entry.merkleRoot },
        );
    }

    const allowedOps = normalizePermittedOperations(license);

    // 3. Check license start date
    if (license.validFrom) {
        const validFromTime = new Date(license.validFrom).getTime();
        if (!Number.isNaN(validFromTime) && now.getTime() < validFromTime) {
            deny(
                "LICENSE_NOT_YET_VALID",
                `License ${license.licenseId} is not valid until ${license.validFrom}.`,
                { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
            );
        }
    }

    // 6. Check license expiration
    const expiryRaw = license.expiresAt ?? license.validUntil;
    const expiresAt = new Date(expiryRaw);
    if (Number.isNaN(expiresAt.getTime())) {
        deny(
            "INVALID_LICENSE",
            `License ${license.licenseId} has an unreadable expiry '${expiryRaw}'.`,
            { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
        );
    }
    if (now.getTime() >= expiresAt.getTime()) {
        deny(
            "LICENSE_EXPIRED",
            `License ${license.licenseId} expired at ${expiresAt.toISOString()}.`,
            { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
        );
    }

    // 7. Check requested operation
    if (!isOperationAllowed(requestedOp, allowedOps)) {
        deny(
            "OPERATION_NOT_PERMITTED",
            `This dataset is licensed for ${allowedOps.join(" / ")} only. ${requestedOp} is not permitted.`,
            { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
        );
    }

    // 8. Check account/user access status
    const account = accountStore.getAccount(readerId, organizationId);
    if (account.status === "LOCKED") {
        deny(
            "ACCOUNT_LOCKED",
            `Access rejected: Account '${readerId}' is LOCKED due to prior compliance violations.`,
            { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
        );
    }
    if (account.status === "RESTRICTED") {
        deny(
            "ACCOUNT_RESTRICTED",
            `Access rejected: Account '${readerId}' is currently RESTRICTED.`,
            { licenseId: license.licenseId, blobHash: entry.merkleRoot, allowedOperations: allowedOps, license },
        );
    }

    // 9. Retrieve the dataset from Shelby
    let served: Awaited<ReturnType<BlobDownloader["download"]>>;
    try {
        served = await downloader.download({ blobName });
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Shelby read failed for blob '${blobName}': ${detail}`);
    }

    // 10. Recompute/verify the Merkle root
    const computedMerkleRoot = await computeMerkleRoot(served.bytes);

    // 11. Ensure it matches the registered root
    if (computedMerkleRoot.toLowerCase() !== entry.merkleRoot.toLowerCase()) {
        deny(
            "MERKLE_MISMATCH",
            `Merkle root verification failed for '${blobName}': served bytes hash to ${computedMerkleRoot}, but registered commitment is ${entry.merkleRoot}.`,
            { licenseId: license.licenseId, blobHash: computedMerkleRoot, allowedOperations: allowedOps, license },
        );
    }

    const receipt: ReadReceipt = {
        blobName,
        servedByAccount: served.servedByAccount,
        merkleRoot: computedMerkleRoot,
        contentSha256: `0x${createHash("sha256").update(served.bytes).digest("hex")}`,
        servedBytes: served.contentLength,
        servedAt: now.toISOString(),
        merkleRootMatchesManifest: true,
    };

    const readEvent: ReadEvent = {
        blobHash: computedMerkleRoot,
        licenseId: license.licenseId,
        readerId,
        trainingRunId,
        timestamp: receipt.servedAt,
        receiptPayload: receipt,
    };

    // 12. Create the Aptos receipt. FAIL CLOSED if Aptos fails!
    let receiptLogTransactionHash: string;
    try {
        receiptLogTransactionHash = await receiptLogWriter.logRead(readEvent);
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        deny(
            "APTOS_RECEIPT_FAILURE",
            `Failed to anchor immutable access receipt on Aptos: ${detail}. Access denied under fail-closed security.`,
            { licenseId: license.licenseId, blobHash: computedMerkleRoot, allowedOperations: allowedOps, license },
        );
    }

    // 13. Only after successful Aptos confirmation should the dataset be returned.
    const isUtf8 = isTextContent(served.bytes);
    const contentString = isUtf8 ? Buffer.from(served.bytes).toString("utf8") : undefined;

    violationStore.recordAccess({
        id: randomUUID(),
        timestamp: now.toISOString(),
        dataset: blobName,
        blobHash: computedMerkleRoot,
        licenseId: license.licenseId,
        readerId,
        organizationId,
        trainingRunId,
        operation: requestedOp,
        allowedOperations: allowedOps,
        status: "ALLOWED",
        verdict: "ACCESS_GRANTED",
        merkleVerified: true,
        receiptLogTransactionHash,
        contentLength: served.bytes.byteLength,
    });

    return {
        status: "GRANTED",
        content: served.bytes,
        contentString,
        receipt,
        license,
        readEvent,
        merkleVerified: true,
        receiptLogTransactionHash,
        explorerUrl: `https://explorer.aptoslabs.com/txn/${receiptLogTransactionHash}?network=shelbynet`,
    };
}

function isTextContent(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
    for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
            return false;
        }
    }
    return true;
}
