import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
    createDefaultErasureCodingProvider,
    generateCommitments,
} from "@shelby-protocol/sdk/node";
import type { LicenseMetadata, ManifestEntry } from "../licenses/schema.js";
import { validateLicenseMetadata } from "../licenses/validate.js";
import { getShelbyContext } from "../shelby/client.js";
import { appendManifestEntry, DEFAULT_MANIFEST_PATH } from "./manifest.js";

/**
 * Uploading is expressed as this narrow interface so unit tests can run without
 * touching the network, and so the real SDK call lives in exactly one place.
 */
export interface BlobUploader {
    upload(params: {
        blobData: Uint8Array;
        blobName: string;
        expirationMicros: number;
    }): Promise<void>;
    /**
     * Hex blob merkle root for the bytes. Shelby's upload() returns void, so the
     * root is computed with the same generateCommitments() function the upload
     * path uses internally, which is what gets registered on chain.
     */
    computeMerkleRoot(blobData: Uint8Array): Promise<string>;
}

export interface UploadResult {
    entry: ManifestEntry;
}

const MICROS_PER_DAY = 24 * 60 * 60 * 1_000_000;

/** Lazily created so tests that inject an uploader never build the real client. */
export function createShelbyUploader(): BlobUploader {
    const { client, signer } = getShelbyContext();
    return {
        async upload({ blobData, blobName, expirationMicros }) {
            await client.upload({ blobData, signer, blobName });
        },
        async computeMerkleRoot(blobData) {
            const provider = await createDefaultErasureCodingProvider();
            const commitments = await generateCommitments(provider, blobData);
            return commitments.blob_merkle_root;
        },
    };
}

/**
 * Reads a file that must live inside `rootDirectory`. Resolving both paths and
 * comparing prefixes blocks traversal such as passing "../../.env" as a dataset
 * member, which would otherwise upload a secret to public storage.
 */
function readFileWithinRoot(filePath: string, rootDirectory: string): Uint8Array {
    const resolvedRoot = resolve(rootDirectory);
    const resolvedFile = resolve(filePath);
    const relativePath = relative(resolvedRoot, resolvedFile);
    if (relativePath === "" || relativePath.startsWith("..") || relativePath.startsWith(`${sep}`)) {
        throw new Error(
            `Refusing to upload ${resolvedFile} because it is outside ${resolvedRoot}.`,
        );
    }
    if (!statSync(resolvedFile).isFile()) {
        throw new Error(`${resolvedFile} is not a regular file.`);
    }
    return readFileSync(resolvedFile);
}

export interface UploadLicensedFileParams {
    filePath: string;
    blobName: string;
    license: unknown;
    expirationDays: number;
    /** Directory the file must reside in. Defaults to the file's own directory tree root. */
    rootDirectory: string;
    uploader?: BlobUploader;
    manifestPath?: string;
    now?: Date;
}

/**
 * Validates the license, uploads the bytes to Shelby with an expiration, then
 * records the blob to license mapping in the manifest. The manifest write happens
 * last so a failed upload never leaves a compliance claim for data that is not
 * actually stored.
 */
export async function uploadLicensedFile(
    params: UploadLicensedFileParams,
): Promise<UploadResult> {
    const {
        filePath,
        blobName,
        license,
        expirationDays,
        rootDirectory,
        manifestPath = DEFAULT_MANIFEST_PATH,
        now = new Date(),
    } = params;

    if (blobName.trim() === "") {
        throw new Error("blobName is required.");
    }
    if (!Number.isFinite(expirationDays) || expirationDays <= 0) {
        throw new Error("expirationDays must be a positive number.");
    }

    const validatedLicense = validateLicenseMetadata(license, now);
    const blobData = readFileWithinRoot(filePath, rootDirectory);

    const uploader = params.uploader ?? createShelbyUploader();
    const expirationMicros = now.getTime() * 1000 + Math.round(expirationDays * MICROS_PER_DAY);

    const merkleRoot = await uploader.computeMerkleRoot(blobData);
    try {
        await uploader.upload({ blobData, blobName, expirationMicros });
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Shelby upload failed for blob '${blobName}': ${detail}`);
    }

    const entry: ManifestEntry = {
        blobName,
        merkleRoot,
        license: validatedLicense,
        uploadedAt: now.toISOString(),
        blobExpiresAt: new Date(expirationMicros / 1000).toISOString(),
        sizeBytes: blobData.byteLength,
    };
    appendManifestEntry(entry, manifestPath);
    return { entry };
}

export interface UploadDatasetParams {
    directory: string;
    /** Maps a file name relative to `directory` to that file's license metadata. */
    licensesByFile: Record<string, unknown>;
    expirationDays: number;
    uploader?: BlobUploader;
    manifestPath?: string;
    now?: Date;
    /** Prefix applied to blob names so datasets do not collide in one account namespace. */
    blobNamePrefix?: string;
}

export interface DatasetUploadReport {
    uploaded: ManifestEntry[];
}

/**
 * Uploads every file in a directory. All licenses are validated before the first
 * network call, and any invalid or missing license fails the whole batch with a
 * combined report. A half-uploaded dataset is worse than none, because a training
 * run against it would look complete while missing assets.
 */
export async function uploadDataset(
    params: UploadDatasetParams,
): Promise<DatasetUploadReport> {
    const {
        directory,
        licensesByFile,
        expirationDays,
        manifestPath = DEFAULT_MANIFEST_PATH,
        now = new Date(),
        blobNamePrefix = "",
    } = params;

    const resolvedDirectory = resolve(directory);
    const dirEntries = await readdir(resolvedDirectory, { withFileTypes: true });
    const fileNames = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    if (fileNames.length === 0) {
        throw new Error(`No files found in ${resolvedDirectory}.`);
    }

    const validatedLicenses = new Map<string, LicenseMetadata>();
    const problems: string[] = [];
    for (const fileName of fileNames) {
        const license = licensesByFile[fileName];
        if (license === undefined) {
            problems.push(`${fileName}: no license provided`);
            continue;
        }
        try {
            validatedLicenses.set(fileName, validateLicenseMetadata(license, now));
        } catch (cause) {
            problems.push(`${fileName}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
    }
    const unknownFiles = Object.keys(licensesByFile).filter(
        (fileName) => !fileNames.includes(fileName),
    );
    for (const fileName of unknownFiles) {
        problems.push(`${fileName}: license provided but file is not in ${resolvedDirectory}`);
    }

    if (problems.length > 0) {
        throw new Error(
            `Dataset upload aborted, ${problems.length} license problem(s) found:\n  ${problems.join("\n  ")}`,
        );
    }

    const uploader = params.uploader ?? createShelbyUploader();
    const uploaded: ManifestEntry[] = [];
    for (const fileName of fileNames) {
        const result = await uploadLicensedFile({
            filePath: resolve(resolvedDirectory, fileName),
            blobName: `${blobNamePrefix}${fileName}`,
            license: validatedLicenses.get(fileName),
            expirationDays,
            rootDirectory: resolvedDirectory,
            uploader,
            manifestPath,
            now,
        });
        uploaded.push(result.entry);
    }
    return { uploaded };
}
