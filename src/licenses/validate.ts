import {
    PERMITTED_USES,
    type LicenseMetadata,
    type PermittedUse,
} from "./schema.js";

/** Thrown for any license that fails validation, so callers can catch one type. */
export class LicenseValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LicenseValidationError";
    }
}

function requireNonEmptyString(
    value: unknown,
    fieldName: string,
): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new LicenseValidationError(
            `License field '${fieldName}' must be a non-empty string.`,
        );
    }
    return value.trim();
}

function isPermittedUse(value: unknown): value is PermittedUse {
    return typeof value === "string" && (PERMITTED_USES as readonly string[]).includes(value);
}

/**
 * Validates untrusted license input and returns a normalized LicenseMetadata.
 * This is the only way license metadata should enter the system, since the
 * upload pipeline trusts whatever this function returns.
 *
 * @param now Injectable clock so tests can check expiry without waiting.
 */
export function validateLicenseMetadata(
    input: unknown,
    now: Date = new Date(),
): LicenseMetadata {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new LicenseValidationError("License metadata must be an object.");
    }

    const candidate = input as Record<string, unknown>;

    const licenseId = requireNonEmptyString(candidate.licenseId, "licenseId");
    const rightsHolder = requireNonEmptyString(candidate.rightsHolder, "rightsHolder");
    const source = requireNonEmptyString(candidate.source, "source");

    // Handle permittedUse with backward compatibility for permittedOperations
    let permittedUse = candidate.permittedUse as PermittedUse;
    if (!isPermittedUse(permittedUse)) {
        if (Array.isArray(candidate.permittedOperations) && candidate.permittedOperations.length > 0) {
            const firstOp = String(candidate.permittedOperations[0]).toLowerCase();
            if (firstOp === "both" || firstOp === "training") {
                permittedUse = "training";
            } else if (firstOp === "inference") {
                permittedUse = "inference";
            } else if (firstOp === "evaluation") {
                permittedUse = "evaluation";
            }
        }
    }
    if (!isPermittedUse(permittedUse)) {
        throw new LicenseValidationError(
            `License field 'permittedUse' must be one of: ${PERMITTED_USES.join(", ")}.`,
        );
    }

    // Support expiresAt or validUntil
    const rawExpiry = candidate.expiresAt ?? candidate.validUntil;
    const expiresAtRaw = requireNonEmptyString(rawExpiry, "expiresAt");
    const expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new LicenseValidationError(
            `License field 'expiresAt' must be an ISO 8601 timestamp, got '${expiresAtRaw}'.`,
        );
    }
    // A date-only string parses fine but silently means midnight UTC, which is a
    // different expiry than the operator likely intended, so require a full timestamp.
    if (!expiresAtRaw.includes("T")) {
        throw new LicenseValidationError(
            `License field 'expiresAt' must include a time, for example 2030-01-01T00:00:00Z.`,
        );
    }
    if (expiresAt.getTime() <= now.getTime()) {
        throw new LicenseValidationError(
            `License '${licenseId}' expired at ${expiresAt.toISOString()} and cannot be attached to an upload.`,
        );
    }

    // Parse permittedOperations
    let permittedOperations: ("TRAINING" | "INFERENCE" | "BOTH" | "EVALUATION")[] | undefined;
    if (candidate.permittedOperations !== undefined) {
        if (!Array.isArray(candidate.permittedOperations)) {
            throw new LicenseValidationError("License field 'permittedOperations' must be an array.");
        }
        permittedOperations = candidate.permittedOperations.map((op) => {
            const normalized = String(op).toUpperCase();
            if (!["TRAINING", "INFERENCE", "BOTH", "EVALUATION"].includes(normalized)) {
                throw new LicenseValidationError(`Unknown operation '${op}' in permittedOperations.`);
            }
            return normalized as "TRAINING" | "INFERENCE" | "BOTH" | "EVALUATION";
        });
    } else {
        const defaultOp = permittedUse.toUpperCase() as "TRAINING" | "INFERENCE" | "EVALUATION";
        permittedOperations = [defaultOp];
    }

    // Parse authorizedUsers & authorizedOrganizations
    let authorizedUsers: string[] | undefined;
    if (candidate.authorizedUsers !== undefined) {
        if (!Array.isArray(candidate.authorizedUsers)) {
            throw new LicenseValidationError("License field 'authorizedUsers' must be an array of strings.");
        }
        authorizedUsers = candidate.authorizedUsers.map(String).map((u) => u.trim()).filter(Boolean);
    }

    let authorizedOrganizations: string[] | undefined;
    if (candidate.authorizedOrganizations !== undefined) {
        if (!Array.isArray(candidate.authorizedOrganizations)) {
            throw new LicenseValidationError("License field 'authorizedOrganizations' must be an array of strings.");
        }
        authorizedOrganizations = candidate.authorizedOrganizations.map(String).map((o) => o.trim()).filter(Boolean);
    }

    // Parse validFrom
    let validFrom: string | undefined;
    if (candidate.validFrom !== undefined && candidate.validFrom !== null && candidate.validFrom !== "") {
        const vf = new Date(String(candidate.validFrom));
        if (Number.isNaN(vf.getTime())) {
            throw new LicenseValidationError(`License field 'validFrom' must be an ISO 8601 timestamp.`);
        }
        validFrom = vf.toISOString();
    }

    return {
        licenseId,
        rightsHolder,
        permittedUse,
        expiresAt: expiresAt.toISOString(),
        source,
        datasetName: candidate.datasetName ? String(candidate.datasetName).trim() : undefined,
        datasetDescription: candidate.datasetDescription ? String(candidate.datasetDescription).trim() : undefined,
        validFrom,
        validUntil: expiresAt.toISOString(),
        permittedOperations,
        authorizedUsers,
        authorizedOrganizations,
        maxAccessStatus: candidate.maxAccessStatus ? String(candidate.maxAccessStatus) : undefined,
        usageRestrictions: candidate.usageRestrictions ? String(candidate.usageRestrictions) : undefined,
        violationPolicy: typeof candidate.violationPolicy === "object" && candidate.violationPolicy !== null
            ? (candidate.violationPolicy as any)
            : undefined,
        status: (candidate.status as any) ?? "ACTIVE",
    };
}

/**
 * True when the license is still valid at `now` and covers `intendedUse`.
 * Used by the read path, where the license was already validated at upload time
 * but may have expired since.
 */
export function isLicenseUsableFor(
    license: LicenseMetadata,
    intendedUse: PermittedUse,
    now: Date = new Date(),
): { usable: true } | { usable: false; reason: string } {
    const expiresAt = new Date(license.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
        return {
            usable: false,
            reason: `License '${license.licenseId}' has an unparseable expiresAt value.`,
        };
    }
    if (expiresAt.getTime() <= now.getTime()) {
        return {
            usable: false,
            reason: `License '${license.licenseId}' expired at ${expiresAt.toISOString()}.`,
        };
    }
    if (license.permittedUse !== intendedUse) {
        return {
            usable: false,
            reason: `License '${license.licenseId}' permits '${license.permittedUse}', not '${intendedUse}'.`,
        };
    }
    return { usable: true };
}
