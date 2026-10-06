import type { LicenseMetadata, ManifestEntry, PermittedUse } from "../../../src/licenses/schema.js";
import type { AuditReport } from "../../../src/audit/reportGenerator.js";
import type { ReadEvent, ReadReceipt } from "../../../src/read/receiptMiddleware.js";
import type {
    AccessRecord,
    AccountRecord,
    AccountStatus,
    ViolationEvent,
} from "../../../src/access/types.js";
import type { DatasetAccessSummary } from "../../../src/access/violationStore.js";

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
    datasetName?: string;
    datasetDescription?: string;
    validFrom?: string;
    validUntil?: string;
    permittedOperations?: string[];
    authorizedUsers?: string[];
    authorizedOrganizations?: string[];
    usageRestrictions?: string;
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

export interface ControlledAccessRequest {
    blobName: string;
    readerId?: string;
    trainingRunId?: string;
    organizationId?: string;
    operation: string;
}

export interface ControlledAccessResponse {
    status: "GRANTED" | "DENIED";
    data?: string;
    isText?: boolean;
    contentBytes?: number;
    receipt?: ReadReceipt;
    license?: LicenseMetadata;
    readEvent?: Omit<ReadEvent, "receiptPayload">;
    merkleVerified?: boolean;
    receiptLogTransactionHash?: string;
    explorerUrl?: string;
    error?: string;
    reason?: string;
    eventType?: string;
    violation?: ViolationEvent;
    accountStatus?: AccountStatus;
    violationCount?: number;
}

export type ControlledAccessSuccess = ControlledAccessResponse & {
    status: "GRANTED";
    receipt: ReadReceipt;
    license: LicenseMetadata;
    receiptLogTransactionHash: string;
    explorerUrl: string;
};


export interface DashboardResponse {
    datasets: DatasetAccessSummary[];
    recentEvents: AccessRecord[];
    violations: ViolationEvent[];
    accounts: AccountRecord[];
}

export interface AuditResponse {
    report: AuditReport;
    explorerUrls: Record<string, string>;
}

export class LICENSEITApiError extends Error {
    readonly status: number;
    readonly violation?: ViolationEvent;
    readonly accountStatus?: AccountStatus;
    readonly violationCount?: number;
    readonly eventType?: string;

    constructor(
        status: number,
        message: string,
        context: {
            violation?: ViolationEvent;
            accountStatus?: AccountStatus;
            violationCount?: number;
            eventType?: string;
        } = {},
    ) {
        super(message);
        this.name = "LICENSEITApiError";
        this.status = status;
        this.violation = context.violation;
        this.accountStatus = context.accountStatus;
        this.violationCount = context.violationCount;
        this.eventType = context.eventType;
    }
}

async function parseResponse<T>(response: Response): Promise<T> {
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new LICENSEITApiError(response.status, "The API returned a response that was not JSON.");
    }
    if (!response.ok) {
        const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
        const message =
            record.error ? String(record.error) : (record.reason ? String(record.reason) : `The request failed with status ${response.status}.`);

        throw new LICENSEITApiError(response.status, message, {
            violation: record.violation as ViolationEvent | undefined,
            accountStatus: record.accountStatus as AccountStatus | undefined,
            violationCount: typeof record.violationCount === "number" ? record.violationCount : undefined,
            eventType: record.eventType ? String(record.eventType) : undefined,
        });
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

export async function requestControlledAccess(request: ControlledAccessRequest): Promise<ControlledAccessResponse> {
    return postJson<ControlledAccessResponse>("/access/request", request);
}

export async function fetchDashboard(): Promise<DashboardResponse> {
    const response = await fetch(`${API_BASE}/dashboard`);
    return parseResponse<DashboardResponse>(response);
}

export async function resetAccounts(): Promise<{ success: boolean; message: string }> {
    return postJson<{ success: boolean; message: string }>("/accounts/reset", {});
}

export async function updateAccountStatus(
    readerId: string,
    status: AccountStatus,
): Promise<{ success: boolean; account: AccountRecord }> {
    return postJson<{ success: boolean; account: AccountRecord }>("/accounts/status", { readerId, status });
}

export async function fetchAuditReport(trainingRunId: string): Promise<AuditResponse> {
    const response = await fetch(`${API_BASE}/audit?run=${encodeURIComponent(trainingRunId)}`);
    return parseResponse<AuditResponse>(response);
}

export async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const CHUNK = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    }
    return btoa(binary);
}
