import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LicenseValidationError, validateLicenseMetadata } from "../src/licenses/validate.js";
import { findManifestEntry } from "../src/upload/manifest.js";
import { uploadDataset, uploadLicensedFile, type BlobUploader } from "../src/upload/uploadPipeline.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function validLicense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        licenseId: "LIC-001",
        rightsHolder: "Example Archive Ltd",
        permittedUse: "training",
        expiresAt: "2027-01-01T00:00:00.000Z",
        source: "Signed data license agreement, 2025-11-02",
        ...overrides,
    };
}

/** Records calls so tests can assert nothing hit the network on the reject paths. */
function createRecordingUploader(): BlobUploader & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async upload({ blobName }) {
            calls.push(blobName);
        },
        async computeMerkleRoot() {
            return "0xdeadbeef";
        },
    };
}

function makeWorkspace(): { directory: string; manifestPath: string } {
    const directory = mkdtempSync(join(tmpdir(), "LICENSEIT-test-"));
    return { directory, manifestPath: join(directory, "manifest.json") };
}

test("validateLicenseMetadata accepts a complete license and normalizes the timestamp", () => {
    const license = validateLicenseMetadata(validLicense(), NOW);
    assert.equal(license.licenseId, "LIC-001");
    assert.equal(license.permittedUse, "training");
    assert.equal(license.expiresAt, "2027-01-01T00:00:00.000Z");
});

test("validateLicenseMetadata rejects a non-object input", () => {
    assert.throws(() => validateLicenseMetadata("LIC-001", NOW), LicenseValidationError);
});

test("validateLicenseMetadata rejects each missing required field", () => {
    for (const field of ["licenseId", "rightsHolder", "permittedUse", "expiresAt", "source"]) {
        const input = validLicense();
        delete input[field];
        assert.throws(
            () => validateLicenseMetadata(input, NOW),
            (error: unknown) =>
                error instanceof LicenseValidationError && error.message.includes(field),
            `expected rejection for missing ${field}`,
        );
    }
});

test("validateLicenseMetadata rejects an unsupported permittedUse", () => {
    assert.throws(
        () => validateLicenseMetadata(validLicense({ permittedUse: "resale" }), NOW),
        /permittedUse/,
    );
});

test("validateLicenseMetadata rejects a malformed expiry", () => {
    assert.throws(
        () => validateLicenseMetadata(validLicense({ expiresAt: "not-a-date" }), NOW),
        /expiresAt/,
    );
});

test("validateLicenseMetadata rejects a date without a time component", () => {
    assert.throws(
        () => validateLicenseMetadata(validLicense({ expiresAt: "2027-01-01" }), NOW),
        /must include a time/,
    );
});

test("validateLicenseMetadata rejects an already expired license", () => {
    assert.throws(
        () => validateLicenseMetadata(validLicense({ expiresAt: "2025-01-01T00:00:00.000Z" }), NOW),
        /expired at/,
    );
});

test("uploadLicensedFile writes a manifest entry with the merkle root", async () => {
    const { directory, manifestPath } = makeWorkspace();
    const filePath = join(directory, "sample.txt");
    writeFileSync(filePath, "training sample");
    const uploader = createRecordingUploader();

    const { entry } = await uploadLicensedFile({
        filePath,
        blobName: "LICENSEIT/sample.txt",
        license: validLicense(),
        expirationDays: 30,
        rootDirectory: directory,
        uploader,
        manifestPath,
        now: NOW,
    });

    assert.deepEqual(uploader.calls, ["LICENSEIT/sample.txt"]);
    assert.equal(entry.merkleRoot, "0xdeadbeef");
    assert.equal(entry.sizeBytes, "training sample".length);
    assert.equal(entry.uploadedAt, NOW.toISOString());
    assert.equal(entry.blobExpiresAt, "2026-01-31T00:00:00.000Z");

    const stored = findManifestEntry("LICENSEIT/sample.txt", manifestPath);
    assert.equal(stored?.license.licenseId, "LIC-001");
});

test("uploadLicensedFile rejects an invalid license before uploading", async () => {
    const { directory, manifestPath } = makeWorkspace();
    const filePath = join(directory, "sample.txt");
    writeFileSync(filePath, "training sample");
    const uploader = createRecordingUploader();

    await assert.rejects(
        uploadLicensedFile({
            filePath,
            blobName: "LICENSEIT/sample.txt",
            license: validLicense({ expiresAt: "2025-01-01T00:00:00.000Z" }),
            expirationDays: 30,
            rootDirectory: directory,
            uploader,
            manifestPath,
            now: NOW,
        }),
        LicenseValidationError,
    );
    assert.deepEqual(uploader.calls, []);
    assert.equal(findManifestEntry("LICENSEIT/sample.txt", manifestPath), undefined);
});

test("uploadLicensedFile refuses a path outside the root directory", async () => {
    const { directory, manifestPath } = makeWorkspace();
    const outsideDirectory = mkdtempSync(join(tmpdir(), "LICENSEIT-outside-"));
    const secretPath = join(outsideDirectory, "secret.env");
    writeFileSync(secretPath, "SHELBY_ACCOUNT_PRIVATE_KEY=ed25519-priv-0xabc");
    const uploader = createRecordingUploader();

    await assert.rejects(
        uploadLicensedFile({
            filePath: secretPath,
            blobName: "LICENSEIT/secret.env",
            license: validLicense(),
            expirationDays: 30,
            rootDirectory: directory,
            uploader,
            manifestPath,
            now: NOW,
        }),
        /outside/,
    );
    assert.deepEqual(uploader.calls, []);
});

test("uploadDataset fails the whole batch when one license is invalid", async () => {
    const { directory, manifestPath } = makeWorkspace();
    writeFileSync(join(directory, "one.txt"), "one");
    writeFileSync(join(directory, "two.txt"), "two");
    const uploader = createRecordingUploader();

    await assert.rejects(
        uploadDataset({
            directory,
            licensesByFile: {
                "one.txt": validLicense(),
                "two.txt": validLicense({ permittedUse: "resale" }),
            },
            expirationDays: 7,
            uploader,
            manifestPath,
            now: NOW,
        }),
        /Dataset upload aborted/,
    );
    assert.deepEqual(uploader.calls, []);
});

test("uploadDataset uploads every file when all licenses are valid", async () => {
    const { directory, manifestPath } = makeWorkspace();
    writeFileSync(join(directory, "one.txt"), "one");
    writeFileSync(join(directory, "two.txt"), "two");
    const uploader = createRecordingUploader();

    const report = await uploadDataset({
        directory,
        licensesByFile: {
            "one.txt": validLicense(),
            "two.txt": validLicense({ licenseId: "LIC-002" }),
        },
        expirationDays: 7,
        uploader,
        manifestPath,
        now: NOW,
        blobNamePrefix: "demo/",
    });

    assert.equal(report.uploaded.length, 2);
    assert.deepEqual(uploader.calls.sort(), ["demo/one.txt", "demo/two.txt"]);
    assert.equal(findManifestEntry("demo/two.txt", manifestPath)?.license.licenseId, "LIC-002");
});

test("uploadDataset reports a license naming a file that is not present", async () => {
    const { directory, manifestPath } = makeWorkspace();
    writeFileSync(join(directory, "one.txt"), "one");
    const uploader = createRecordingUploader();

    await assert.rejects(
        uploadDataset({
            directory,
            licensesByFile: {
                "one.txt": validLicense(),
                "missing.txt": validLicense(),
            },
            expirationDays: 7,
            uploader,
            manifestPath,
            now: NOW,
        }),
        /missing.txt/,
    );
    assert.deepEqual(uploader.calls, []);
});
