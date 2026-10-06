import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Request, type Response } from "express";
import { generateAuditReport } from "../../src/audit/reportGenerator.js";
import { PERMITTED_USES, type PermittedUse } from "../../src/licenses/schema.js";
import { LicenseValidationError } from "../../src/licenses/validate.js";
import { LicenseDeniedError, readLicensedBlob } from "../../src/read/receiptMiddleware.js";
import { uploadLicensedFile } from "../../src/upload/uploadPipeline.js";
import { evaluateAccessRequest, AccessDeniedError } from "../../src/access/policyEngine.js";
import { globalAccountStore } from "../../src/access/accountStore.js";
import { globalViolationStore } from "../../src/access/violationStore.js";
import { readManifest } from "../../src/upload/manifest.js";

/**
 * Thin HTTP layer over the LICENSEIT functions from Sprints 2 through 5.
 *
 * It holds no business logic. Uploads call uploadLicensedFile, reads call
 * readLicensedBlob, and audits call generateAuditReport, so the license rules and
 * the receipt handling are the ones already tested rather than a second
 * implementation that could drift.
 *
 * The private key stays in this process. The browser never sees it, and nothing
 * from .env is sent to a client, because signing and paid Shelby operations all
 * happen here.
 */
const DEFAULT_PORT = 8787;

/** Larger inputs are rejected before any work, so the funded account cannot be drained by abuse. */
const MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_FIELD_LENGTH = 512;
const MAX_BLOB_EXPIRATION_DAYS = 30;

/** One paid request per client per window. Every upload and read spends real
 * ShelbyUSD and gas, so this is the difference between a bounded bill and an
 * open faucet for anyone who can reach the port. */
const MIN_MS_BETWEEN_PAID_REQUESTS = 2000;
const paidRequestLastSeen = new Map<string, number>();

const EXPLORER_TRANSACTION_BASE =
    "https://explorer.aptoslabs.com/txn/{hash}?network=shelbynet";

interface RequestFailure {
    status: number;
    message: string;
}

/** Every request body field passes through here, so no route trusts raw input. */
function readStringField(
    body: Record<string, unknown>,
    field: string,
    { required = true }: { required?: boolean } = {},
): string {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") {
        if (required) {
            throw { status: 400, message: `${field} is required.` } satisfies RequestFailure;
        }
        return "";
    }
    if (typeof raw !== "string") {
        throw { status: 400, message: `${field} must be a string.` } satisfies RequestFailure;
    }
    const value = raw.trim();
    if (value.length > MAX_FIELD_LENGTH) {
        throw {
            status: 413,
            message: `${field} must be ${MAX_FIELD_LENGTH} characters or fewer.`,
        } satisfies RequestFailure;
    }
    return value;
}

function readPermittedUse(body: Record<string, unknown>, field: string): PermittedUse {
    const value = readStringField(body, field);
    if (!(PERMITTED_USES as readonly string[]).includes(value)) {
        throw {
            status: 400,
            message: `${field} must be one of ${PERMITTED_USES.join(", ")}.`,
        } satisfies RequestFailure;
    }
    return value as PermittedUse;
}

/**
 * Blob names become paths in Shelby's namespace, so they are restricted to a
 * conservative character set. Rejecting "." segments blocks a name that would
 * resolve outside the LICENSEIT prefix.
 */
function readBlobName(body: Record<string, unknown>, field: string): string {
    const value = readStringField(body, field);
    if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
        throw {
            status: 400,
            message: `${field} may only contain letters, digits, dot, dash, underscore, and slash.`,
        } satisfies RequestFailure;
    }
    if (value.split("/").some((segment) => segment === "." || segment === "..")) {
        throw {
            status: 400,
            message: `${field} may not contain a '.' or '..' path segment.`,
        } satisfies RequestFailure;
    }
    return value;
}

/**
 * The browser sends file bytes base64 encoded in JSON. They are written to a
 * per-request temp directory and the upload pipeline is pointed at that directory
 * as its root, which keeps the pipeline's own traversal guard meaningful.
 */
function decodeUploadBytes(body: Record<string, unknown>): Buffer {
    const raw = body.fileBase64;
    if (typeof raw !== "string" || raw === "") {
        throw { status: 400, message: "fileBase64 is required." } satisfies RequestFailure;
    }
    const bytes = Buffer.from(raw, "base64");
    if (bytes.byteLength === 0) {
        throw { status: 400, message: "The selected file is empty." } satisfies RequestFailure;
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw {
            status: 413,
            message: `Files must be ${MAX_UPLOAD_BYTES} bytes or smaller.`,
        } satisfies RequestFailure;
    }
    return bytes;
}

function readExpirationDays(body: Record<string, unknown>): number {
    const raw = body.expirationDays;
    const days = typeof raw === "number" ? raw : Number(raw ?? "7");
    if (!Number.isFinite(days) || days <= 0 || days > MAX_BLOB_EXPIRATION_DAYS) {
        throw {
            status: 400,
            message: `expirationDays must be between 1 and ${MAX_BLOB_EXPIRATION_DAYS}.`,
        } satisfies RequestFailure;
    }
    return days;
}

/**
 * Throttles the two routes that spend tokens. Without this a held-down button
 * could empty the ShelbyUSD balance and take LICENSEIT offline.
 */
function enforcePaidRequestInterval(request: Request): void {
    const client = request.ip ?? "unknown";
    const now = Date.now();
    const previous = paidRequestLastSeen.get(client);
    if (previous !== undefined && now - previous < MIN_MS_BETWEEN_PAID_REQUESTS) {
        throw {
            status: 429,
            message: "One paid request at a time. Wait a moment and try again.",
        } satisfies RequestFailure;
    }
    paidRequestLastSeen.set(client, now);
}

/**
 * Maps a failure to a status and a message. LICENSEIT errors carry the real reason,
 * for example which license rule refused a read, and those are worth showing.
 * Anything unrecognized becomes a generic 500 rather than leaking internals.
 */
function toErrorResponse(error: unknown): RequestFailure {
    if (typeof error === "object" && error !== null && "status" in error && "message" in error) {
        const failure = error as RequestFailure;
        return { status: failure.status, message: failure.message };
    }
    if (error instanceof LicenseDeniedError) {
        return { status: 403, message: error.message };
    }
    if (error instanceof LicenseValidationError) {
        return { status: 400, message: error.message };
    }
    if (error instanceof Error) {
        return { status: 502, message: error.message };
    }
    return { status: 500, message: "The request failed for an unknown reason." };
}

function sendFailure(response: Response, error: unknown): void {
    if (error instanceof AccessDeniedError) {
        console.warn(`Policy denial: ${error.eventType} - ${error.message}`);
        response.status(403).json({
            status: "DENIED",
            error: error.message,
            reason: error.message,
            eventType: error.eventType,
            violation: error.violation,
            accountStatus: error.accountStatus,
            violationCount: error.violationCount,
        });
        return;
    }
    const failure = toErrorResponse(error);
    // Logged server side with the message only, so an operator can see what broke
    // without the log becoming a place credentials could land.
    console.error(`Request failed with ${failure.status}: ${failure.message}`);
    response.status(failure.status).json({ error: failure.message });
}


function explorerTransactionUrl(transactionHash: string): string {
    return EXPLORER_TRANSACTION_BASE.replace("{hash}", transactionHash);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/upload", async (request, response) => {
    let temporaryDirectory: string | undefined;
    try {
        enforcePaidRequestInterval(request);
        const body = request.body as Record<string, unknown>;
        const blobName = readBlobName(body, "blobName");
        const fileName = readStringField(body, "fileName");
        const license: Record<string, unknown> = {
            licenseId: readStringField(body, "licenseId"),
            rightsHolder: readStringField(body, "rightsHolder"),
            permittedUse: body.permittedUse ? readPermittedUse(body, "permittedUse") : "training",
            expiresAt: body.expiresAt
                ? readStringField(body, "expiresAt")
                : (body.validUntil ? readStringField(body, "validUntil") : ""),
            source: readStringField(body, "source"),
            datasetName: body.datasetName ? readStringField(body, "datasetName", { required: false }) : undefined,
            datasetDescription: body.datasetDescription ? readStringField(body, "datasetDescription", { required: false }) : undefined,
            validFrom: body.validFrom ? readStringField(body, "validFrom", { required: false }) : undefined,
            validUntil: body.validUntil ? readStringField(body, "validUntil", { required: false }) : undefined,
            permittedOperations: Array.isArray(body.permittedOperations)
                ? body.permittedOperations
                : (typeof body.permittedOperations === "string" && body.permittedOperations.trim()
                    ? body.permittedOperations.split(",").map((s) => s.trim())
                    : undefined),
            authorizedUsers: Array.isArray(body.authorizedUsers)
                ? body.authorizedUsers
                : (typeof body.authorizedUsers === "string" && body.authorizedUsers.trim()
                    ? body.authorizedUsers.split(",").map((s) => s.trim())
                    : undefined),
            authorizedOrganizations: Array.isArray(body.authorizedOrganizations)
                ? body.authorizedOrganizations
                : (typeof body.authorizedOrganizations === "string" && body.authorizedOrganizations.trim()
                    ? body.authorizedOrganizations.split(",").map((s) => s.trim())
                    : undefined),
            usageRestrictions: body.usageRestrictions ? readStringField(body, "usageRestrictions", { required: false }) : undefined,
            violationPolicy: typeof body.violationPolicy === "object" ? body.violationPolicy : undefined,
            status: "ACTIVE",
        };
        const bytes = decodeUploadBytes(body);
        const expirationDays = readExpirationDays(body);

        temporaryDirectory = mkdtempSync(join(tmpdir(), "LICENSEIT-web-upload-"));
        // The file name is hashed rather than reused, so a crafted name cannot
        // influence the path even though the pipeline also guards its root.
        const safeName = createHash("sha256").update(fileName).digest("hex").slice(0, 32);
        const filePath = join(temporaryDirectory, safeName);
        writeFileSync(filePath, bytes);

        const { entry } = await uploadLicensedFile({
            filePath,
            blobName,
            license,
            expirationDays,
            rootDirectory: temporaryDirectory,
        });
        response.json({ entry });
    } catch (error) {
        sendFailure(response, error);
    } finally {
        if (temporaryDirectory) {
            rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    }
});

app.post("/api/access/request", async (request, response) => {
    try {
        const body = request.body as Record<string, unknown>;
        const blobName = readBlobName(body, "blobName");
        const readerId = readStringField(body, "readerId", { required: false }) || "anonymous-reader";
        const trainingRunId = readStringField(body, "trainingRunId", { required: false }) || "default-run";
        const organizationId = readStringField(body, "organizationId", { required: false }) || undefined;
        const operation = readStringField(body, "operation", { required: false }) || "TRAINING";

        const result = await evaluateAccessRequest({
            blobName,
            readerId,
            organizationId,
            trainingRunId,
            operation,
        });

        response.json({
            status: "GRANTED",
            data: result.contentString ?? Buffer.from(result.content).toString("base64"),
            isText: !!result.contentString,
            contentBytes: result.content.byteLength,
            receipt: result.receipt,
            license: result.license,
            readEvent: {
                blobHash: result.readEvent.blobHash,
                licenseId: result.readEvent.licenseId,
                readerId: result.readEvent.readerId,
                trainingRunId: result.readEvent.trainingRunId,
                timestamp: result.readEvent.timestamp,
            },
            merkleVerified: result.merkleVerified,
            receiptLogTransactionHash: result.receiptLogTransactionHash,
            explorerUrl: result.explorerUrl,
        });
    } catch (error) {
        sendFailure(response, error);
    }
});

app.get("/api/dashboard", async (_request, response) => {
    try {
        const manifestEntries = readManifest();
        const datasets = manifestEntries.map((entry) => {
            return globalViolationStore.getDatasetSummary(entry.blobName, {
                licenseId: entry.license.licenseId,
                rightsHolder: entry.license.rightsHolder,
                validUntil: entry.license.validUntil ?? entry.license.expiresAt,
                permittedOperations: entry.license.permittedOperations ?? [entry.license.permittedUse.toUpperCase()],
                status: entry.license.status ?? "ACTIVE",
            });
        });

        const recentEvents = globalViolationStore.getAllAccessRecords().slice(-25).reverse();
        const violations = globalViolationStore.getAllViolations().slice(-15).reverse();
        const accounts = globalAccountStore.getAllAccounts();

        response.json({
            datasets,
            recentEvents,
            violations,
            accounts,
        });
    } catch (error) {
        sendFailure(response, error);
    }
});

app.post("/api/accounts/reset", (_request, response) => {
    try {
        globalAccountStore.reset();
        globalViolationStore.reset();
        response.json({ success: true, message: "Accounts and violations reset successfully." });
    } catch (error) {
        sendFailure(response, error);
    }
});

app.post("/api/accounts/status", (request, response) => {
    try {
        const body = request.body as Record<string, unknown>;
        const readerId = readStringField(body, "readerId");
        const status = readStringField(body, "status") as "ACTIVE" | "RESTRICTED" | "LOCKED";
        const updated = globalAccountStore.setStatus(readerId, status);
        response.json({ success: true, account: updated });
    } catch (error) {
        sendFailure(response, error);
    }
});


app.post("/api/read", async (request, response) => {
    try {
        enforcePaidRequestInterval(request);
        const body = request.body as Record<string, unknown>;
        const result = await readLicensedBlob({
            blobName: readBlobName(body, "blobName"),
            readerId: readStringField(body, "readerId"),
            trainingRunId: readStringField(body, "trainingRunId"),
            declaredUse: readPermittedUse(body, "declaredUse"),
        });
        // Content bytes are deliberately not returned. The receipt is what a
        // browser needs, and shipping licensed training data to one is not part
        // of proving provenance.
        response.json({
            receipt: result.receipt,
            license: result.license,
            readEvent: {
                blobHash: result.readEvent.blobHash,
                licenseId: result.readEvent.licenseId,
                readerId: result.readEvent.readerId,
                trainingRunId: result.readEvent.trainingRunId,
                timestamp: result.readEvent.timestamp,
            },
            contentBytes: result.content.byteLength,
            receiptLogTransactionHash: result.receiptLogTransactionHash,
            explorerUrl: explorerTransactionUrl(result.receiptLogTransactionHash),
        });
    } catch (error) {
        sendFailure(response, error);
    }
});

app.get("/api/audit", async (request, response) => {
    try {
        const trainingRunId = readStringField(
            { trainingRunId: request.query.run },
            "trainingRunId",
        );
        const report = await generateAuditReport({ trainingRunId });
        response.json({
            report,
            explorerUrls: Object.fromEntries(
                report.reads.map((read) => [
                    read.transactionHash,
                    explorerTransactionUrl(read.transactionHash),
                ]),
            ),
        });
    } catch (error) {
        sendFailure(response, error);
    }
});

const port = Number(process.env.LICENSEIT_API_PORT ?? DEFAULT_PORT);
app.listen(port, () => {
    console.log(`LICENSEIT API listening on http://localhost:${port}`);
});
