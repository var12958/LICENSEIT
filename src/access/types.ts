import type { LicenseMetadata, PermittedOperation } from "../licenses/schema.js";
import type { ReadReceipt, ReadEvent } from "../read/receiptMiddleware.js";

export type AccessOperation = "TRAINING" | "INFERENCE" | "BOTH" | "EVALUATION";
export type AccountStatus = "ACTIVE" | "RESTRICTED" | "LOCKED";
export type AccessDecision = "ALLOWED" | "BLOCKED";

export type ViolationEventType =
    | "LICENSE_EXPIRED"
    | "LICENSE_NOT_YET_VALID"
    | "OPERATION_NOT_PERMITTED"
    | "USER_NOT_AUTHORIZED"
    | "ORGANIZATION_NOT_AUTHORIZED"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_RESTRICTED"
    | "UNKNOWN_DATASET"
    | "MERKLE_MISMATCH"
    | "INVALID_LICENSE"
    | "APTOS_RECEIPT_FAILURE";

export interface ViolationEvent {
    id: string;
    eventType: ViolationEventType;
    dataset: string;
    blobHash?: string;
    licenseId?: string;
    readerId: string;
    organizationId?: string;
    trainingRunId: string;
    requestedOperation: string;
    allowedOperations: string[];
    timestamp: string;
    action: "ACCESS_BLOCKED" | "USER_WARNED" | "USER_RESTRICTED" | "USER_LOCKED";
    reason: string;
    accountStatusAfter: AccountStatus;
}

export interface AccessRecord {
    id: string;
    timestamp: string;
    dataset: string;
    blobHash?: string;
    licenseId?: string;
    readerId: string;
    organizationId?: string;
    trainingRunId: string;
    operation: string;
    allowedOperations: string[];
    status: AccessDecision;
    verdict: "ACCESS_GRANTED" | ViolationEventType;
    reason?: string;
    actionTaken?: string;
    merkleVerified?: boolean;
    receiptLogTransactionHash?: string;
    contentLength?: number;
}

export interface AccountRecord {
    readerId: string;
    organizationId?: string;
    status: AccountStatus;
    violationCount: number;
    lastViolation?: string;
    lastViolationReason?: string;
    lastSeen: string;
}

export interface ControlledAccessRequest {
    blobName: string;
    readerId?: string;
    organizationId?: string;
    trainingRunId: string;
    operation: string;
    now?: Date;
}

export interface ControlledAccessSuccess {
    status: "GRANTED";
    content: Uint8Array;
    contentString?: string;
    receipt: ReadReceipt;
    license: LicenseMetadata;
    readEvent: ReadEvent;
    merkleVerified: boolean;
    receiptLogTransactionHash: string;
    explorerUrl: string;
}

export interface ControlledAccessDenied {
    status: "DENIED";
    reason: string;
    error: string;
    violation: ViolationEvent;
    accountStatus: AccountStatus;
    violationCount: number;
}

export type ControlledAccessResponse = ControlledAccessSuccess | ControlledAccessDenied;
