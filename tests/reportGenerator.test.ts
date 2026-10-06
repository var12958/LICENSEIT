import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    fetchReadReceipts,
    selectRunReceipts,
    type ReceiptTransactionSource,
} from "../src/audit/chainQuery.js";
import {
    formatAuditReport,
    formatAuditReportAsMarkdown,
    generateAuditReport,
} from "../src/audit/reportGenerator.js";
import type { LicenseMetadata, ManifestEntry } from "../src/licenses/schema.js";
import { writeManifest } from "../src/upload/manifest.js";

const MODULE_ADDRESS = "0xfeed";
const EVENT_TYPE = `${MODULE_ADDRESS}::receipt_log::ReadLogged`;
const BLOB_ROOT = "0x329a2fec6d645d1a85e9a47a5f2e8e94fb3fc7bfec207f2aa868ddb7e4580947";
const READER = "0x95a9e0179f40d0cea2642fe26786fe67fa16d21edbff267746262fdfb06c9be8";

/** 2026-08-16T15:59:59.876Z in microseconds, matching the real logged read. */
const READ_AT_US = 1_786_896_001_876_525;

function license(overrides: Partial<LicenseMetadata> = {}): LicenseMetadata {
    return {
        licenseId: "LIC-EXAMPLE-001",
        rightsHolder: "Example Archive Ltd",
        permittedUse: "training",
        expiresAt: "2027-01-01T00:00:00.000Z",
        source: "Signed data license agreement",
        ...overrides,
    };
}

function manifestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
    return {
        blobName: "LICENSEIT/example-dataset.txt",
        merkleRoot: BLOB_ROOT,
        license: license(),
        uploadedAt: "2026-08-16T15:24:00.589Z",
        blobExpiresAt: "2026-08-23T15:24:00.589Z",
        sizeBytes: 99,
        ...overrides,
    };
}

function writeTestManifest(entries: ManifestEntry[]): string {
    const manifestPath = join(mkdtempSync(join(tmpdir(), "LICENSEIT-audit-")), "manifest.json");
    writeManifest(entries, manifestPath);
    return manifestPath;
}

function transaction(
    events: Array<{ type: string; data: unknown }>,
    hash = "0xtxn1",
    version = "49795744",
): unknown {
    return { hash, version, events };
}

function readLoggedEvent(overrides: Record<string, unknown> = {}) {
    return {
        type: EVENT_TYPE,
        data: {
            blob_hash: BLOB_ROOT,
            license_id: "LIC-EXAMPLE-001",
            reader: READER,
            training_run_id: "run-sprint4",
            timestamp_us: String(READ_AT_US),
            ...overrides,
        },
    };
}

function source(pages: unknown[][]): ReceiptTransactionSource & { calls: number[] } {
    const calls: number[] = [];
    let index = 0;
    return {
        calls,
        async fetchTransactions(offset) {
            calls.push(offset);
            const page = pages[index] ?? [];
            index += 1;
            return page;
        },
    };
}

test("fetchReadReceipts decodes ReadLogged events from account transactions", async () => {
    const receipts = await fetchReadReceipts({
        source: source([[transaction([readLoggedEvent()])]]),
        moduleAddress: MODULE_ADDRESS,
    });

    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].blobHash, BLOB_ROOT);
    assert.equal(receipts[0].licenseId, "LIC-EXAMPLE-001");
    assert.equal(receipts[0].reader, READER);
    assert.equal(receipts[0].trainingRunId, "run-sprint4");
    assert.equal(receipts[0].timestampUs, READ_AT_US);
    assert.equal(receipts[0].timestamp, new Date(READ_AT_US / 1000).toISOString());
    assert.equal(receipts[0].transactionHash, "0xtxn1");
});

test("fetchReadReceipts ignores events from other modules and other deployments", async () => {
    const receipts = await fetchReadReceipts({
        source: source([
            [
                transaction([
                    { type: "0x1::coin::WithdrawEvent", data: { amount: "1" } },
                    // Same module name at a different address, i.e. someone else's log.
                    { type: "0xbeef::receipt_log::ReadLogged", data: readLoggedEvent().data },
                    readLoggedEvent(),
                ]),
            ],
        ]),
        moduleAddress: MODULE_ADDRESS,
    });

    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].transactionHash, "0xtxn1");
});

test("fetchReadReceipts skips malformed events instead of failing the whole audit", async () => {
    const receipts = await fetchReadReceipts({
        source: source([
            [
                transaction([
                    { type: EVENT_TYPE, data: { blob_hash: BLOB_ROOT } },
                    { type: EVENT_TYPE, data: null },
                    { type: EVENT_TYPE, data: readLoggedEvent({ timestamp_us: "not-a-number" }).data },
                    readLoggedEvent(),
                ]),
            ],
        ]),
        moduleAddress: MODULE_ADDRESS,
    });

    assert.equal(receipts.length, 1);
});

test("fetchReadReceipts returns receipts oldest first regardless of page order", async () => {
    const receipts = await fetchReadReceipts({
        source: source([
            [
                transaction([readLoggedEvent({ timestamp_us: String(READ_AT_US + 5_000_000) })], "0xlate"),
                transaction([readLoggedEvent({ timestamp_us: String(READ_AT_US) })], "0xearly"),
            ],
        ]),
        moduleAddress: MODULE_ADDRESS,
    });

    assert.deepEqual(
        receipts.map((receipt) => receipt.transactionHash),
        ["0xearly", "0xlate"],
    );
});

test("fetchReadReceipts stops paging when a short page arrives", async () => {
    const transactionSource = source([[transaction([readLoggedEvent()])]]);

    await fetchReadReceipts({ source: transactionSource, moduleAddress: MODULE_ADDRESS });

    assert.deepEqual(transactionSource.calls, [0]);
});

test("fetchReadReceipts wraps a query failure without leaking the cause object", async () => {
    const failingSource: ReceiptTransactionSource = {
        async fetchTransactions() {
            throw new Error("429 Too Many Requests from https://api.shelbynet.shelby.xyz/v1");
        },
    };

    await assert.rejects(
        fetchReadReceipts({ source: failingSource, moduleAddress: MODULE_ADDRESS }),
        (error: unknown) =>
            error instanceof Error &&
            error.message.startsWith("Failed to read the on-chain receipt log:") &&
            error.cause === undefined,
    );
});

test("selectRunReceipts keeps only the requested run", async () => {
    const receipts = await fetchReadReceipts({
        source: source([
            [
                transaction([
                    readLoggedEvent(),
                    readLoggedEvent({ training_run_id: "run-other" }),
                ]),
            ],
        ]),
        moduleAddress: MODULE_ADDRESS,
    });

    assert.equal(selectRunReceipts(receipts, "run-sprint4").length, 1);
    assert.equal(selectRunReceipts(receipts, "run-nothing").length, 0);
});

test("generateAuditReport reports a licensed run as compliant", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([manifestEntry()]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
        now: new Date("2026-08-16T16:30:00.000Z"),
    });

    assert.equal(report.compliant, true);
    assert.equal(report.totalReads, 1);
    assert.equal(report.compliantReads, 1);
    assert.equal(report.distinctBlobs, 1);
    assert.deepEqual(report.problems, []);
    assert.equal(report.reads[0].verdict, "compliant");
    assert.equal(report.reads[0].blobName, "LICENSEIT/example-dataset.txt");
    assert.equal(report.reads[0].license?.rightsHolder, "Example Archive Ltd");
});

/**
 * The critical case for this whole project. The license has expired by the time the
 * report runs, but it was valid when the read happened, so the read is compliant. A
 * report that compared against "now" would wrongly condemn a lawful read.
 */
test("generateAuditReport judges each read against the license at read time, not now", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([
            manifestEntry({ license: license({ expiresAt: "2026-08-17T00:00:00.000Z" }) }),
        ]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
        now: new Date("2030-01-01T00:00:00.000Z"),
    });

    assert.equal(report.compliant, true);
    assert.equal(report.reads[0].verdict, "compliant");
});

test("generateAuditReport flags a read that happened after its license expired", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([
            manifestEntry({ license: license({ expiresAt: "2026-01-01T00:00:00.000Z" }) }),
        ]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    assert.equal(report.compliant, false);
    assert.equal(report.reads[0].verdict, "expired-at-read");
    assert.match(report.problems[0], /happened after license LIC-EXAMPLE-001 expired/);
});

test("generateAuditReport flags a read whose blob is not in the manifest", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    assert.equal(report.compliant, false);
    assert.equal(report.reads[0].verdict, "unknown-blob");
    assert.equal(report.reads[0].blobName, undefined);
    assert.match(report.problems[0], /No manifest entry matches this blob hash/);
});

test("generateAuditReport flags a chain license that disagrees with the manifest", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([
            manifestEntry({ license: license({ licenseId: "LIC-DIFFERENT" }) }),
        ]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    assert.equal(report.compliant, false);
    assert.equal(report.reads[0].verdict, "unlicensed");
    assert.match(report.problems[0], /but the manifest records LIC-DIFFERENT/);
});

test("generateAuditReport treats a run with no logged reads as not compliant", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-never-happened",
        manifestPath: writeTestManifest([manifestEntry()]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    assert.equal(report.compliant, false);
    assert.equal(report.totalReads, 0);
    assert.match(report.problems[0], /No reads were logged on chain/);
});

test("generateAuditReport requires a training run id", async () => {
    await assert.rejects(
        generateAuditReport({
            trainingRunId: "   ",
            manifestPath: writeTestManifest([manifestEntry()]),
            receipts: [],
        }),
        /trainingRunId is required/,
    );
});

test("formatAuditReport prints the verdict, each read, and the findings", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([manifestEntry()]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    const text = formatAuditReport(report);
    assert.match(text, /Audit report for training run run-sprint4/);
    assert.match(text, /verdict: COMPLIANT/);
    assert.match(text, /OK {3}LICENSEIT\/example-dataset\.txt/);
    assert.match(text, /txn 0xtxn1/);
    assert.doesNotMatch(text, /Findings:/);
});

test("markdown report carries a verification entry for every read", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([manifestEntry()]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    const markdown = formatAuditReportAsMarkdown(report);
    assert.match(markdown, /^# Audit report for training run run-sprint4$/m);
    assert.match(markdown, /Verdict: compliant\./);
    assert.match(markdown, /\| verified \| LICENSEIT\/example-dataset\.txt \| LIC-EXAMPLE-001 \|/);
    // The verification section is the point of the Markdown format: an auditor must
    // be able to resolve every hash without trusting the report.
    assert.match(markdown, /## Verification/);
    assert.match(markdown, new RegExp(`blob hash: \`${BLOB_ROOT}\``));
    assert.match(markdown, /transactions\/by_hash\/0xtxn1/);
});

test("markdown report reports an empty run as an absence of evidence", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-with-no-reads",
        manifestPath: writeTestManifest([manifestEntry()]),
        receipts: [],
    });

    const markdown = formatAuditReportAsMarkdown(report);
    assert.match(markdown, /Verdict: not compliant\./);
    assert.match(markdown, /absence of evidence/);
    assert.match(markdown, /## Findings/);
});

test("markdown report flags a read whose license had expired, without dropping it", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([
            manifestEntry({ license: license({ expiresAt: "2026-01-01T00:00:00.000Z" }) }),
        ]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    const markdown = formatAuditReportAsMarkdown(report);
    assert.match(markdown, /\| flagged: expired-at-read \|/);
    assert.match(markdown, /## Findings/);
    // A flagged read still appears in verification. Removing it would hide the finding.
    assert.match(markdown, /transactions\/by_hash\/0xtxn1/);
});

test("markdown report escapes a pipe in metadata so the table cannot be broken", async () => {
    const report = await generateAuditReport({
        trainingRunId: "run-sprint4",
        manifestPath: writeTestManifest([
            manifestEntry({ license: license({ rightsHolder: "Archive | Ltd" }) }),
        ]),
        moduleAddress: MODULE_ADDRESS,
        source: source([[transaction([readLoggedEvent()])]]),
    });

    assert.match(formatAuditReportAsMarkdown(report), /Archive \\\| Ltd/);
});
