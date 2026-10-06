import { createHash } from "node:crypto";
import { AccountAddress } from "@aptos-labs/ts-sdk";
import {
    createDefaultErasureCodingProvider,
    generateCommitments,
} from "@shelby-protocol/sdk/node";
import { logReadOnChain } from "../audit/chainWriter.js";
import type { LicenseMetadata, PermittedUse } from "../licenses/schema.js";
import { getShelbyContext } from "../shelby/client.js";
import { DEFAULT_MANIFEST_PATH, findManifestEntry } from "../upload/manifest.js";

/**
 * What the SDK actually returns for a read, verified against the installed
 * @shelby-protocol/sdk 0.7.1 type ShelbyBlob in dist/core/blobs.d.ts and the
 * download example at https://docs.shelby.xyz/sdks/typescript/node:
 *
 *   client.download({ account, blobName }) => Promise<ShelbyBlob>
 *   ShelbyBlob = { account: AccountAddress; name: string; readable: ReadableStream; contentLength: number }
 *
 * There is no receipt object on that response. The SDK exposes no field named
 * receipt, signature, or proof anywhere in its public types, so the "cryptographic
 * receipt" for a read has to be assembled here from what the read verifiably
 * produced: the served bytes, the blob merkle root recomputed from those bytes
 * with the same generateCommitments() the upload path used, and the account and
 * name the RPC served them under. Recomputing the root is the verification step,
 * because it only matches the root recorded at upload if the bytes served are the
 * bytes that were stored.
 */
export interface ReadReceipt {
    blobName: string;
    /** Account namespace the RPC served the blob from, taken from the SDK response. */
    servedByAccount: string;
    /** Blob merkle root recomputed from the served bytes. */
    merkleRoot: string;
    /** SHA-256 of the served bytes, a cheap independent digest for the audit log. */
    contentSha256: string;
    /** Bytes actually received, from the SDK response rather than the manifest. */
    servedBytes: number;
    /** Local time the read completed. The chain timestamp in Sprint 4 is authoritative. */
    servedAt: string;
    /** True when the recomputed root equals the root recorded at upload. */
    merkleRootMatchesManifest: boolean;
}

/**
 * The event Sprint 4 anchors on chain. Every field here either comes from the SDK
 * response or from the validated manifest, never from caller-supplied claims about
 * what was served.
 */
export interface ReadEvent {
    blobHash: string;
    licenseId: string;
    readerId: string;
    trainingRunId: string;
    timestamp: string;
    receiptPayload: ReadReceipt;
    operation?: string;
}

export interface LicensedReadResult {
    content: Uint8Array;
    receipt: ReadReceipt;
    readEvent: ReadEvent;
    license: LicenseMetadata;
    /** Hash of the receipt_log transaction that anchored this read on Aptos. */
    receiptLogTransactionHash: string;
}

/** Thrown when a read is refused on license grounds, before any network call. */
export class LicenseDeniedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LicenseDeniedError";
    }
}

/**
 * Downloading is expressed as this interface so tests can stub the Shelby call.
 * It returns bytes rather than a stream because the receipt needs the whole blob
 * to recompute commitments, and LICENSEIT assets are individual training files.
 */
export interface BlobDownloader {
    download(params: { blobName: string }): Promise<{
        bytes: Uint8Array;
        servedByAccount: string;
        contentLength: number;
    }>;
}

export function createShelbyDownloader(): BlobDownloader {
    const { client, env } = getShelbyContext();
    return {
        async download({ blobName }) {
            const blob = await client.download({
                account: AccountAddress.fromString(env.accountAddress),
                blobName,
            });
            const chunks: Uint8Array[] = [];
            const reader = blob.readable.getReader();
            try {
                for (; ;) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    chunks.push(value as Uint8Array);
                }
            } finally {
                reader.releaseLock();
            }
            return {
                bytes: Buffer.concat(chunks),
                servedByAccount: blob.account.toString(),
                contentLength: blob.contentLength,
            };
        },
    };
}

/** Injected so tests can assert on-chain logging without submitting transactions. */
export interface ReceiptLogWriter {
    logRead(event: ReadEvent): Promise<string>;
}

const aptosReceiptLogWriter: ReceiptLogWriter = {
    logRead: (event) => logReadOnChain({ event }),
};

export interface ReadLicensedBlobParams {
    blobName: string;
    readerId: string;
    trainingRunId: string;
    /** What the caller intends to do with the bytes, checked against the license. */
    declaredUse: PermittedUse;
    downloader?: BlobDownloader;
    receiptLogWriter?: ReceiptLogWriter;
    manifestPath?: string;
    now?: Date;
}

/**
 * The only path through which LICENSEIT data may be read. It resolves the blob's
 * license from the manifest, refuses the read if the license does not cover the
 * declared use or has expired, and only then downloads. Checking first means an
 * unauthorized read never fetches bytes, so there is nothing to leak.
 */
export async function readLicensedBlob(
    params: ReadLicensedBlobParams,
): Promise<LicensedReadResult> {
    const {
        blobName,
        readerId,
        trainingRunId,
        declaredUse,
        manifestPath = DEFAULT_MANIFEST_PATH,
        now = new Date(),
    } = params;

    if (readerId.trim() === "") {
        throw new Error("readerId is required, an unattributed read cannot be audited.");
    }
    if (trainingRunId.trim() === "") {
        throw new Error("trainingRunId is required so the read can be tied to a run.");
    }
    if (blobName.trim() === "") {
        throw new Error("blobName is required.");
    }

    const entry = findManifestEntry(blobName, manifestPath);
    if (!entry) {
        throw new LicenseDeniedError(
            `Blob '${blobName}' has no manifest entry, so its license is unknown and it will not be served.`,
        );
    }

    const license = entry.license;
    if (license.permittedUse !== declaredUse) {
        throw new LicenseDeniedError(
            `License ${license.licenseId} permits ${license.permittedUse}, not ${declaredUse}.`,
        );
    }
    const expiresAt = new Date(license.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new LicenseDeniedError(
            `License ${license.licenseId} has an unreadable expiry '${license.expiresAt}'.`,
        );
    }
    if (expiresAt.getTime() <= now.getTime()) {
        throw new LicenseDeniedError(
            `License ${license.licenseId} expired at ${expiresAt.toISOString()} and cannot cover a read at ${now.toISOString()}.`,
        );
    }

    const downloader = params.downloader ?? createShelbyDownloader();
    let served: Awaited<ReturnType<BlobDownloader["download"]>>;
    try {
        served = await downloader.download({ blobName });
    } catch (cause) {
        // Only the message is forwarded. Shelby client errors can carry request
        // configuration, and config carries credentials.
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Shelby read failed for blob '${blobName}': ${detail}`);
    }

    const merkleRoot = await computeMerkleRoot(served.bytes);
    const receipt: ReadReceipt = {
        blobName,
        servedByAccount: served.servedByAccount,
        merkleRoot,
        contentSha256: `0x${createHash("sha256").update(served.bytes).digest("hex")}`,
        servedBytes: served.contentLength,
        servedAt: now.toISOString(),
        merkleRootMatchesManifest: merkleRoot === entry.merkleRoot,
    };

    if (!receipt.merkleRootMatchesManifest) {
        throw new Error(
            `Blob '${blobName}' served bytes whose merkle root ${merkleRoot} does not match the root recorded at upload (${entry.merkleRoot}). Refusing to hand back unverified content.`,
        );
    }

    const readEvent: ReadEvent = {
        blobHash: merkleRoot,
        licenseId: license.licenseId,
        readerId,
        trainingRunId,
        timestamp: receipt.servedAt,
        receiptPayload: receipt,
    };

    // A chain write failure propagates and the caller gets no content, even though
    // the bytes were already fetched. That is deliberate: LICENSEIT's guarantee is
    // that every served read is logged, so a read the audit trail does not contain
    // must not look like a successful read. Returning content with a swallowed
    // logging error would produce exactly the silent gap the audit exists to catch.
    const writer = params.receiptLogWriter ?? aptosReceiptLogWriter;
    const receiptLogTransactionHash = await writer.logRead(readEvent);

    return {
        content: served.bytes,
        receipt,
        readEvent,
        license,
        receiptLogTransactionHash,
    };
}

/** Kept separate so the erasure coding provider is only built when a read succeeds. */
export async function computeMerkleRoot(bytes: Uint8Array): Promise<string> {
    const provider = await createDefaultErasureCodingProvider();
    const commitments = await generateCommitments(provider, bytes);
    return commitments.blob_merkle_root;
}
