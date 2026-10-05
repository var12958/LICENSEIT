import type { LicenseMetadata, ManifestEntry, PermittedUse } from "../../../src/licenses/schema.js";
import type { AuditReport } from "../../../src/audit/reportGenerator.js";
import type { ReadEvent, ReadReceipt } from "../../../src/read/receiptMiddleware.js";

/**
 * Browser side calls into the local API in web/server. Types are imported from
 * src/ rather than redeclared, so a change to a receipt or report shape is a
 * compile error here instead of a silently wrong table at runtime.
 */
const API_BASE = "/api";

export interface UploadRequest {
    blobName: string;
    fileName: string;
    fileBase64: string;
    expirationDays: number;
    licenseId: string;
    rightsHolder: string;
    permittedUse: PermittedUse;
    expiresAt: string;
    source: string;
}

export interface UploadResponse {
    entry: ManifestEntry;
}

export interface ReadRequest {
    blobName: string;
    readerId: string;
    trainingRunId: string;
    declaredUse: PermittedUse;
}

export interface ReadResponse {
    receipt: ReadReceipt;
    license: LicenseMetadata;
    readEvent: Omit<ReadEvent, "receiptPayload">;
    contentBytes: number;
    receiptLogTransactionHash: string;
    explorerUrl: string;
}

export interface AuditResponse {
    report: AuditReport;
    explorerUrls: Record<string, string>;
}

/**
 * A failed call carries the server's message so the UI can show the actual
 * reason, for example a license that expired before the read was attempted.
 */
export class LicenNodeApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "LicenNodeApiError";
        this.status = status;
    }
}

async function parseResponse<T>(response: Response): Promise<T> {
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new LicenNodeApiError(response.status, "The API returned a response that was not JSON.");
    }
    if (!response.ok) {
        const message =
            typeof payload === "object" && payload !== null && "error" in payload
                ? String((payload as { error: unknown }).error)
                : `The request failed with status ${response.status}.`;
        throw new LicenNodeApiError(response.status, message);
    }
    return payload as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    return parseResponse<T>(response);
}

export async function uploadLicensedFileRequest(request: UploadRequest): Promise<UploadResponse> {
    return postJson<UploadResponse>("/upload", request);
}

export async function readLicensedBlobRequest(request: ReadRequest): Promise<ReadResponse> {
    return postJson<ReadResponse>("/read", request);
}

export async function fetchAuditReport(trainingRunId: string): Promise<AuditResponse> {
    const response = await fetch(`${API_BASE}/audit?run=${encodeURIComponent(trainingRunId)}`);
    return parseResponse<AuditResponse>(response);
}

/**
 * Reads a File into base64 in chunks. A plain spread of the byte array blows the
 * argument limit on files of any size, so the conversion walks fixed windows.
 */
export async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const CHUNK = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    }
    return btoa(binary);
}
