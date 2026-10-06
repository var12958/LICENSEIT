import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LicenseMetadata, ManifestEntry } from "../src/licenses/schema.js";
import {
    LicenseDeniedError,
    readLicensedBlob,
    type BlobDownloader,
    type ReceiptLogWriter,
} from "../src/read/receiptMiddleware.js";
import { writeManifest } from "../src/upload/manifest.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const SERVED_BYTES = Buffer.from("licensed training sample");

/**
 * The blob merkle root generateCommitments produces for SERVED_BYTES, taken from a
 * real run of the middleware. It is hardcoded so the manifest fixture agrees with
 * what the middleware recomputes, which lets tests reach the code after the root
 * comparison without stubbing the commitment step.
 */
const CORRECT_ROOT = "0xef58d927f5143157bfed36c903d44cbb908cf06472d34e4b58a755d20995460c";

function license(overrides: Partial<LicenseMetadata> = {}): LicenseMetadata {
    return {
        licenseId: "LIC-001",
        rightsHolder: "Example Archive Ltd",
        permittedUse: "training",
        expiresAt: "2027-01-01T00:00:00.000Z",
        source: "Signed data license agreement, 2025-11-02",
        ...overrides,
    };
}

function manifestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
    return {
        blobName: "LICENSEIT/sample.txt",
        merkleRoot: CORRECT_ROOT,
        license: license(),
        uploadedAt: "2025-12-01T00:00:00.000Z",
        blobExpiresAt: "2026-12-01T00:00:00.000Z",
        sizeBytes: SERVED_BYTES.byteLength,
        ...overrides,
    };
}

/** Stubs the download so no test touches the network. */
function createStubDownloader(): BlobDownloader & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async download({ blobName }) {
            calls.push(blobName);
            return {
                bytes: SERVED_BYTES,
                servedByAccount: "0xabc",
                contentLength: SERVED_BYTES.byteLength,
            };
        },
    };
}

/** Stubs the on-chain write so no test submits a transaction or needs a funded key. */
function createStubReceiptLogWriter(
    hash = "0xtxn",
): ReceiptLogWriter & { loggedRunIds: string[] } {
    const loggedRunIds: string[] = [];
    return {
        loggedRunIds,
        async logRead(event) {
            loggedRunIds.push(event.trainingRunId);
            return hash;
        },
    };
}

function writeTestManifest(entries: ManifestEntry[]): string {
    const manifestPath = join(mkdtempSync(join(tmpdir(), "LICENSEIT-read-")), "manifest.json");
    writeManifest(entries, manifestPath);
    return manifestPath;
}

test("readLicensedBlob returns content, a receipt, and a logged transaction hash", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const downloader = createStubDownloader();
    const receiptLogWriter = createStubReceiptLogWriter("0xlogged");

    const result = await readLicensedBlob({
        blobName: "LICENSEIT/sample.txt",
        readerId: "trainer-1",
        trainingRunId: "run-42",
        declaredUse: "training",
        downloader,
        receiptLogWriter,
        manifestPath,
        now: NOW,
    });

    assert.deepEqual(downloader.calls, ["LICENSEIT/sample.txt"]);
    assert.equal(Buffer.from(result.content).toString(), SERVED_BYTES.toString());
    assert.equal(result.receipt.merkleRoot, CORRECT_ROOT);
    assert.equal(result.receipt.merkleRootMatchesManifest, true);
    assert.equal(result.receipt.servedByAccount, "0xabc");
    assert.equal(result.receipt.servedAt, NOW.toISOString());
    assert.equal(result.readEvent.blobHash, CORRECT_ROOT);
    assert.equal(result.readEvent.licenseId, "LIC-001");
    assert.equal(result.receiptLogTransactionHash, "0xlogged");
    assert.deepEqual(receiptLogWriter.loggedRunIds, ["run-42"]);
});

test("readLicensedBlob refuses content whose served bytes do not match the upload root", async () => {
    const manifestPath = writeTestManifest([manifestEntry({ merkleRoot: "0xdeadbeef" })]);
    const receiptLogWriter = createStubReceiptLogWriter();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader: createStubDownloader(),
            receiptLogWriter,
            manifestPath,
            now: NOW,
        }),
        /does not match the root recorded at upload/,
    );
    // Tampered content is never logged as a legitimate read.
    assert.deepEqual(receiptLogWriter.loggedRunIds, []);
});

test("readLicensedBlob rejects an unknown blob without downloading", async () => {
    const manifestPath = writeTestManifest([]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/missing.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader,
            manifestPath,
            now: NOW,
        }),
        (error: unknown) =>
            error instanceof LicenseDeniedError && /no manifest entry/.test(error.message),
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob rejects a use the license does not permit", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "inference",
            downloader,
            manifestPath,
            now: NOW,
        }),
        (error: unknown) =>
            error instanceof LicenseDeniedError &&
            /permits training, not inference/.test(error.message),
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob rejects an expired license before downloading", async () => {
    const manifestPath = writeTestManifest([
        manifestEntry({ license: license({ expiresAt: "2025-06-01T00:00:00.000Z" }) }),
    ]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader,
            manifestPath,
            now: NOW,
        }),
        (error: unknown) =>
            error instanceof LicenseDeniedError && /expired at/.test(error.message),
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob rejects an unreadable license expiry", async () => {
    const manifestPath = writeTestManifest([
        manifestEntry({ license: license({ expiresAt: "whenever" }) }),
    ]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader,
            manifestPath,
            now: NOW,
        }),
        /unreadable expiry/,
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob requires a reader id", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "   ",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader,
            manifestPath,
            now: NOW,
        }),
        /readerId is required/,
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob requires a training run id", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const downloader = createStubDownloader();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "",
            declaredUse: "training",
            downloader,
            manifestPath,
            now: NOW,
        }),
        /trainingRunId is required/,
    );
    assert.deepEqual(downloader.calls, []);
});

test("readLicensedBlob wraps a download failure without leaking the cause object", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const failingDownloader: BlobDownloader = {
        async download() {
            throw new Error("RPC 503 from https://shelby.shelbynet.shelby.xyz/shelby");
        },
    };

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader: failingDownloader,
            receiptLogWriter: createStubReceiptLogWriter(),
            manifestPath,
            now: NOW,
        }),
        (error: unknown) =>
            error instanceof Error &&
            error.message.startsWith("Shelby read failed for blob 'LICENSEIT/sample.txt':") &&
            error.cause === undefined,
    );
});

test("readLicensedBlob does not log a refused read on chain", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const downloader = createStubDownloader();
    const receiptLogWriter = createStubReceiptLogWriter();

    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "evaluation",
            downloader,
            receiptLogWriter,
            manifestPath,
            now: NOW,
        }),
        LicenseDeniedError,
    );
    assert.deepEqual(downloader.calls, []);
    assert.deepEqual(receiptLogWriter.loggedRunIds, []);
});

test("readLicensedBlob surfaces a chain logging failure instead of returning content", async () => {
    const manifestPath = writeTestManifest([manifestEntry()]);
    const failingWriter: ReceiptLogWriter = {
        async logRead() {
            throw new Error("Failed to log read of blob 0xroot for run run-42 on chain: timeout");
        },
    };

    // The bytes were already fetched at this point. The read still fails, because a
    // served read missing from the audit log would be an invisible compliance gap.
    await assert.rejects(
        readLicensedBlob({
            blobName: "LICENSEIT/sample.txt",
            readerId: "trainer-1",
            trainingRunId: "run-42",
            declaredUse: "training",
            downloader: createStubDownloader(),
            receiptLogWriter: failingWriter,
            manifestPath,
            now: NOW,
        }),
        /Failed to log read/,
    );
});
