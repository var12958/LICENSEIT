import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccessRecord, ViolationEvent } from "./types.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_EVENTS_PATH = resolve(PROJECT_ROOT, "data", "access_events.json");

export interface DatasetAccessSummary {
    blobName: string;
    licenseId: string;
    rightsHolder: string;
    validUntil: string;
    permittedOperations: string[];
    accessStatus: "ACTIVE" | "RESTRICTED" | "LOCKED" | "REVOKED";
    successfulRequests: number;
    blockedRequests: number;
    violations: number;
    latestEvent?: string;
    latestEventTimestamp?: string;
}

export class ViolationStore {
    private accessRecords: AccessRecord[] = [];
    private violations: ViolationEvent[] = [];
    private filePath: string;

    constructor(filePath = DEFAULT_EVENTS_PATH) {
        this.filePath = filePath;
        this.load();
    }

    private load(): void {
        try {
            const raw = readFileSync(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.accessRecords)) {
                    this.accessRecords = parsed.accessRecords;
                }
                if (Array.isArray(parsed.violations)) {
                    this.violations = parsed.violations;
                }
            }
        } catch {
            // First time load or empty file
        }
    }

    private save(): void {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const temp = `${this.filePath}.${process.pid}.tmp`;
            const payload = JSON.stringify(
                {
                    accessRecords: this.accessRecords,
                    violations: this.violations,
                },
                null,
                2,
            );
            writeFileSync(temp, `${payload}\n`, "utf8");
            renameSync(temp, this.filePath);
        } catch (err) {
            console.error("ViolationStore failed to write file:", err);
        }
    }

    recordAccess(record: AccessRecord): void {
        this.accessRecords.push(record);
        this.save();
    }

    recordViolation(violation: ViolationEvent): void {
        this.violations.push(violation);
        this.save();
    }

    getAllAccessRecords(): AccessRecord[] {
        return [...this.accessRecords];
    }

    getAllViolations(): ViolationEvent[] {
        return [...this.violations];
    }

    getRecordsForRun(trainingRunId: string): AccessRecord[] {
        return this.accessRecords.filter((r) => r.trainingRunId === trainingRunId);
    }

    getViolationsForRun(trainingRunId: string): ViolationEvent[] {
        return this.violations.filter((v) => v.trainingRunId === trainingRunId);
    }

    getDatasetSummary(
        blobName: string,
        fallbackMetadata?: {
            licenseId?: string;
            rightsHolder?: string;
            validUntil?: string;
            permittedOperations?: string[];
            status?: "ACTIVE" | "RESTRICTED" | "LOCKED" | "REVOKED";
        },
    ): DatasetAccessSummary {
        const records = this.accessRecords.filter((r) => r.dataset === blobName);
        const violations = this.violations.filter((v) => v.dataset === blobName);

        const successfulRequests = records.filter((r) => r.status === "ALLOWED").length;
        const blockedRequests = records.filter((r) => r.status === "BLOCKED").length;

        const latestRecord = records[records.length - 1];
        const latestViolation = violations[violations.length - 1];

        let latestEvent = "No access events yet";
        let latestEventTimestamp: string | undefined;

        if (latestRecord) {
            latestEventTimestamp = latestRecord.timestamp;
            if (latestRecord.status === "ALLOWED") {
                latestEvent = `${latestRecord.operation} access granted`;
            } else {
                latestEvent = `${latestRecord.operation} attempt blocked (${latestRecord.reason ?? latestRecord.verdict})`;
            }
        }

        return {
            blobName,
            licenseId: fallbackMetadata?.licenseId ?? latestRecord?.licenseId ?? "UNKNOWN",
            rightsHolder: fallbackMetadata?.rightsHolder ?? "N/A",
            validUntil: fallbackMetadata?.validUntil ?? "N/A",
            permittedOperations: fallbackMetadata?.permittedOperations ?? ["TRAINING"],
            accessStatus: fallbackMetadata?.status ?? "ACTIVE",
            successfulRequests,
            blockedRequests,
            violations: violations.length,
            latestEvent,
            latestEventTimestamp,
        };
    }

    reset(): void {
        this.accessRecords = [];
        this.violations = [];
        this.save();
    }
}

export const globalViolationStore = new ViolationStore();
