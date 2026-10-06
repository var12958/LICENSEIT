import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ManifestEntry } from "../licenses/schema.js";

/**
 * The manifest is the local join table between Shelby blobs and their licenses.
 * Shelby stores bytes and commitments, not rights information, so the mapping
 * from blob name to license has to live somewhere the read path can consult
 * before serving anything. It is a file rather than a database because the audit
 * chain of record is Aptos, and this only needs to be a fast local lookup.
 *
 * The path is resolved from this file's location, not from the working directory.
 * The web API runs with its own working directory, and a manifest that moved with
 * the caller would mean a blob uploaded by the CLI looked unlicensed to the API,
 * which the read path would correctly but wrongly refuse to serve. One LICENSEIT install has
 * one manifest.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_MANIFEST_PATH = resolve(PROJECT_ROOT, "data", "manifest.json");

export function readManifest(manifestPath = DEFAULT_MANIFEST_PATH): ManifestEntry[] {
    let raw: string;
    try {
        raw = readFileSync(manifestPath, "utf8");
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw new Error(`Could not read manifest at ${manifestPath}`, { cause });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (cause) {
        throw new Error(
            `Manifest at ${manifestPath} is not valid JSON. Fix or delete it before uploading again.`,
            { cause },
        );
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`Manifest at ${manifestPath} must contain a JSON array.`);
    }
    return parsed as ManifestEntry[];
}

/**
 * Writes the manifest by writing a temp file in the same directory and renaming
 * it over the target. rename is atomic within a filesystem, so a crash mid-write
 * leaves the previous manifest intact rather than a truncated JSON file.
 */
export function writeManifest(
    entries: ManifestEntry[],
    manifestPath = DEFAULT_MANIFEST_PATH,
): void {
    mkdirSync(dirname(manifestPath), { recursive: true });
    const tempPath = `${manifestPath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(tempPath, manifestPath);
}

/** Replaces any existing entry for the same blob name, since a re-upload supersedes it. */
export function appendManifestEntry(
    entry: ManifestEntry,
    manifestPath = DEFAULT_MANIFEST_PATH,
): ManifestEntry[] {
    const entries = readManifest(manifestPath).filter(
        (existing) => existing.blobName !== entry.blobName,
    );
    entries.push(entry);
    writeManifest(entries, manifestPath);
    return entries;
}

export function findManifestEntry(
    blobName: string,
    manifestPath = DEFAULT_MANIFEST_PATH,
): ManifestEntry | undefined {
    return readManifest(manifestPath).find((entry) => entry.blobName === blobName);
}
