import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountRecord, AccountStatus, ViolationEventType } from "./types.js";
import type { ViolationPolicyConfig } from "../licenses/schema.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_ACCOUNTS_PATH = resolve(PROJECT_ROOT, "data", "accounts.json");

export const DEFAULT_WARNING_THRESHOLD = 1;
export const DEFAULT_RESTRICTION_THRESHOLD = 2;
export const DEFAULT_LOCK_THRESHOLD = 3;

export class AccountStore {
    private accounts = new Map<string, AccountRecord>();
    private filePath: string;

    constructor(filePath = DEFAULT_ACCOUNTS_PATH) {
        this.filePath = filePath;
        this.load();
    }

    private load(): void {
        try {
            const raw = readFileSync(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const acc of parsed) {
                    if (acc && typeof acc.readerId === "string") {
                        this.accounts.set(acc.readerId.toLowerCase(), acc);
                    }
                }
            }
        } catch {
            // Missing or empty file is normal on first boot
        }
    }

    private save(): void {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const temp = `${this.filePath}.${process.pid}.tmp`;
            const data = JSON.stringify(Array.from(this.accounts.values()), null, 2);
            writeFileSync(temp, `${data}\n`, "utf8");
            renameSync(temp, this.filePath);
        } catch (err) {
            console.error("AccountStore failed to write file:", err);
        }
    }

    getAccount(readerId: string, organizationId?: string): AccountRecord {
        const key = readerId.toLowerCase();
        let acc = this.accounts.get(key);
        if (!acc) {
            acc = {
                readerId,
                organizationId,
                status: "ACTIVE",
                violationCount: 0,
                lastSeen: new Date().toISOString(),
            };
            this.accounts.set(key, acc);
        }
        if (organizationId && !acc.organizationId) {
            acc.organizationId = organizationId;
        }
        return acc;
    }

    recordViolation(
        readerId: string,
        violationType: ViolationEventType,
        reason: string,
        organizationId?: string,
        policy?: ViolationPolicyConfig,
    ): {
        action: "ACCESS_BLOCKED" | "USER_WARNED" | "USER_RESTRICTED" | "USER_LOCKED";
        statusAfter: AccountStatus;
        violationCount: number;
    } {
        const acc = this.getAccount(readerId, organizationId);
        acc.violationCount += 1;
        acc.lastViolation = violationType;
        acc.lastViolationReason = reason;
        acc.lastSeen = new Date().toISOString();

        const warnLimit = policy?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
        const restrictLimit = policy?.restrictionThreshold ?? DEFAULT_RESTRICTION_THRESHOLD;
        const lockLimit = policy?.lockThreshold ?? DEFAULT_LOCK_THRESHOLD;

        let action: "ACCESS_BLOCKED" | "USER_WARNED" | "USER_RESTRICTED" | "USER_LOCKED" = "ACCESS_BLOCKED";

        if (acc.violationCount >= lockLimit) {
            acc.status = "LOCKED";
            action = "USER_LOCKED";
        } else if (acc.violationCount >= restrictLimit) {
            acc.status = "RESTRICTED";
            action = "USER_RESTRICTED";
        } else if (acc.violationCount >= warnLimit) {
            action = "USER_WARNED";
        }

        this.accounts.set(readerId.toLowerCase(), acc);
        this.save();

        return {
            action,
            statusAfter: acc.status,
            violationCount: acc.violationCount,
        };
    }

    setStatus(readerId: string, status: AccountStatus): AccountRecord {
        const acc = this.getAccount(readerId);
        acc.status = status;
        acc.lastSeen = new Date().toISOString();
        if (status === "ACTIVE") {
            acc.violationCount = 0;
        }
        this.accounts.set(readerId.toLowerCase(), acc);
        this.save();
        return acc;
    }

    getAllAccounts(): AccountRecord[] {
        return Array.from(this.accounts.values());
    }

    reset(): void {
        this.accounts.clear();
        this.save();
    }
}

export const globalAccountStore = new AccountStore();
