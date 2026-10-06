import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LicenseMetadata, ManifestEntry } from "../src/licenses/schema.js";
import { writeManifest } from "../src/upload/manifest.js";
import { AccountStore } from "../src/access/accountStore.js";
import { ViolationStore } from "../src/access/violationStore.js";
import { AccessDeniedError, evaluateAccessRequest } from "../src/access/policyEngine.js";
import type { BlobDownloader, ReceiptLogWriter } from "../src/read/receiptMiddleware.js";

const TEST_NOW = new Date("2026-10-05T12:00:00.000Z");
const SERVED_BYTES = Buffer.from("customer-training-data,sentiment_score=0.98,label=positive");
const CORRECT_ROOT = "0x44a476d6d7f45b0dfe54dafa9bdd19af59ea4796b8050896c36d5287f062e689";

function createStubDownloader(bytes = SERVED_BYTES): BlobDownloader & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async download({ blobName }) {
            calls.push(blobName);
            return {
                bytes,
                servedByAccount: "0xb4157dc8c9d2f5118eaa4bf3a6acc332d75aa103c840fdd546ff934f6bbd0b48",
                contentLength: bytes.byteLength,
            };
        },
    };
}

function createStubReceiptWriter(txHash = "0xaptos_receipt_tx_123"): ReceiptLogWriter & { logged: string[] } {
    const logged: string[] = [];
    return {
        logged,
        async logRead(event) {
            logged.push(event.trainingRunId);
            return txHash;
        },
    };
}

function makeManifest(entries: ManifestEntry[]): string {
    const dir = mkdtempSync(join(tmpdir(), "licennode-test-manifest-"));
    const path = join(dir, "manifest.json");
    writeManifest(entries, path);
    return path;
}

function setupTestEnvironment() {
    const tempDir = mkdtempSync(join(tmpdir(), "licennode-test-stores-"));
    const accountStore = new AccountStore(join(tempDir, "accounts.json"));
    const violationStore = new ViolationStore(join(tempDir, "events.json"));
    return { accountStore, violationStore };
}

// TEST 1: Any reader + valid TRAINING license -> SUCCESSFUL -> DATA FETCH SUCCESSFUL
test("TEST 1: Any reader + valid TRAINING license -> SUCCESSFUL -> DATA FETCH SUCCESSFUL", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                validFrom: "2026-10-05T00:00:00.000Z",
                validUntil: "2027-10-05T23:59:59.000Z",
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "BV Data providers INC agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const receiptWriter = createStubReceiptWriter();

    // Verify multiple arbitrary readers can access without any user allowlist
    const readers = ["UserA.v1", "UserB.v2", "RandomDeveloper.v99"];

    for (const readerId of readers) {
        const result = await evaluateAccessRequest(
            {
                blobName: "customer-data-1mb.csv",
                readerId,
                trainingRunId: `run-${readerId}`,
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
        );

        assert.equal(result.status, "GRANTED");
        assert.equal(result.merkleVerified, true);
        assert.equal(result.receiptLogTransactionHash, "0xaptos_receipt_tx_123");
        assert.ok(result.content.byteLength > 0);
    }

    assert.equal(downloader.calls.length, readers.length);
    assert.equal(receiptWriter.logged.length, readers.length);
});

// TEST 2: Any reader + TRAINING-only license + INFERENCE -> FETCH FAILED -> OPERATION_NOT_PERMITTED -> 0 bytes released
test("TEST 2: Any reader + TRAINING-only license + INFERENCE -> FETCH FAILED -> OPERATION_NOT_PERMITTED -> 0 bytes released", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                validFrom: "2026-10-05T00:00:00.000Z",
                validUntil: "2027-10-05T23:59:59.000Z",
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "BV Data providers INC agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const receiptWriter = createStubReceiptWriter();

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "customer-data-1mb.csv",
                readerId: "AnyReader.v1",
                trainingRunId: "sentiment.v1",
                operation: "INFERENCE",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "OPERATION_NOT_PERMITTED");
            assert.match(err.message, /licensed for TRAINING only/);
            return true;
        },
    );

    // Fail-closed: 0 bytes released! Dataset was NEVER downloaded or logged on Aptos
    assert.deepEqual(downloader.calls, []);
    assert.deepEqual(receiptWriter.logged, []);
    assert.equal(violationStore.getAllViolations().length, 1);
    assert.equal(violationStore.getAllViolations()[0].eventType, "OPERATION_NOT_PERMITTED");
});

// TEST 3: Any reader + expired license -> FETCH FAILED -> LICENSE_EXPIRED -> 0 bytes released
test("TEST 3: Any reader + expired license -> FETCH FAILED -> LICENSE_EXPIRED -> 0 bytes released", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "expired-dataset.txt",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2025-EXPIRED",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                validFrom: "2025-01-01T00:00:00.000Z",
                validUntil: "2026-01-01T00:00:00.000Z",
                expiresAt: "2026-01-01T00:00:00.000Z",
                source: "Expired license",
                status: "ACTIVE",
            },
            uploadedAt: "2025-01-01T00:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "expired-dataset.txt",
                readerId: "AnyReader.v1",
                trainingRunId: "sentiment.v1",
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "LICENSE_EXPIRED");
            assert.match(err.message, /expired at/);
            return true;
        },
    );

    // 0 bytes released
    assert.deepEqual(downloader.calls, []);
});

// TEST 4: Any reader + valid license + permitted operation -> SUCCESSFUL
test("TEST 4: Any reader + valid license + permitted operation -> SUCCESSFUL", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                validFrom: "2026-10-05T00:00:00.000Z",
                validUntil: "2027-10-05T23:59:59.000Z",
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "BV Data providers INC agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const receiptWriter = createStubReceiptWriter();

    const result = await evaluateAccessRequest(
        {
            blobName: "customer-data-1mb.csv",
            readerId: "UserC.v1",
            trainingRunId: "run-sentiment-01",
            operation: "TRAINING",
            now: TEST_NOW,
        },
        { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
    );

    assert.equal(result.status, "GRANTED");
    assert.equal(result.merkleVerified, true);
    assert.equal(result.receipt.blobName, "customer-data-1mb.csv");
    assert.ok(result.content.byteLength > 0);
});

// TEST 5: Unknown dataset -> BLOCK
test("TEST 5: Unknown dataset -> BLOCK", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([]);
    const downloader = createStubDownloader();

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "non-existent-data.csv",
                readerId: "AnyUser.v1",
                trainingRunId: "sentiment.v1",
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "UNKNOWN_DATASET");
            return true;
        },
    );

    assert.deepEqual(downloader.calls, []);
});

// TEST 6: Merkle mismatch -> BLOCK
test("TEST 6: Merkle mismatch -> BLOCK", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: "0xdeadbeef00000000000000000000000000000000000000000000000000000000",
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "Agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const receiptWriter = createStubReceiptWriter();

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "customer-data-1mb.csv",
                readerId: "AnyUser.v1",
                trainingRunId: "sentiment.v1",
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "MERKLE_MISMATCH");
            return true;
        },
    );

    assert.deepEqual(receiptWriter.logged, []);
});

// TEST 7: Aptos transaction failure -> BLOCK / FAIL CLOSED
test("TEST 7: Aptos transaction failure -> BLOCK / FAIL CLOSED", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "Agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const failingReceiptWriter: ReceiptLogWriter = {
        async logRead() {
            throw new Error("Aptos RPC sequence number mismatch / out of gas");
        },
    };

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "customer-data-1mb.csv",
                readerId: "AnyUser.v1",
                trainingRunId: "sentiment.v1",
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: failingReceiptWriter },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "APTOS_RECEIPT_FAILURE");
            assert.match(err.message, /fail-closed security/);
            return true;
        },
    );
});

// TEST 8: Valid license with BOTH permissions -> TRAINING ALLOW, INFERENCE ALLOW
test("TEST 8: Valid license with BOTH permissions -> TRAINING ALLOW, INFERENCE ALLOW", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "dual-model-data.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-DUAL-001",
                rightsHolder: "Dual AI Corp",
                permittedUse: "training",
                permittedOperations: ["TRAINING", "INFERENCE"],
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "Dual license grant",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    const downloader = createStubDownloader();
    const receiptWriter = createStubReceiptWriter();

    // 1. TRAINING -> ALLOW
    const resTraining = await evaluateAccessRequest(
        {
            blobName: "dual-model-data.csv",
            readerId: "UserA.v1",
            trainingRunId: "run-training-01",
            operation: "TRAINING",
            now: TEST_NOW,
        },
        { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
    );
    assert.equal(resTraining.status, "GRANTED");

    // 2. INFERENCE -> ALLOW
    const resInference = await evaluateAccessRequest(
        {
            blobName: "dual-model-data.csv",
            readerId: "UserB.v2",
            trainingRunId: "run-inference-01",
            operation: "INFERENCE",
            now: TEST_NOW,
        },
        { manifestPath, accountStore, violationStore, downloader, receiptLogWriter: receiptWriter },
    );
    assert.equal(resInference.status, "GRANTED");
});

// TEST 9: Locked user -> BLOCK
test("TEST 9: Locked user -> BLOCK", async () => {
    const { accountStore, violationStore } = setupTestEnvironment();
    const manifestPath = makeManifest([
        {
            blobName: "customer-data-1mb.csv",
            merkleRoot: CORRECT_ROOT,
            license: {
                licenseId: "LIC-2026-CUSTOMER-001",
                rightsHolder: "BV Data providers INC",
                permittedUse: "training",
                permittedOperations: ["TRAINING"],
                expiresAt: "2027-10-05T23:59:59.000Z",
                source: "Agreement",
                status: "ACTIVE",
            },
            uploadedAt: "2026-10-05T04:00:00.000Z",
            blobExpiresAt: "2026-11-05T04:00:00.000Z",
            sizeBytes: SERVED_BYTES.byteLength,
        },
    ]);

    // Explicitly lock the user
    accountStore.setStatus("BadActor.v1", "LOCKED");

    const downloader = createStubDownloader();

    await assert.rejects(
        evaluateAccessRequest(
            {
                blobName: "customer-data-1mb.csv",
                readerId: "BadActor.v1",
                trainingRunId: "sentiment.v1",
                operation: "TRAINING",
                now: TEST_NOW,
            },
            { manifestPath, accountStore, violationStore, downloader },
        ),
        (err: unknown) => {
            assert.ok(err instanceof AccessDeniedError);
            assert.equal(err.eventType, "ACCOUNT_LOCKED");
            assert.match(err.message, /is LOCKED/);
            return true;
        },
    );

    assert.deepEqual(downloader.calls, []);
});
