/**
 * License metadata attached to every file LICENSEIT stores.
 *
 * Expiry is stored per file rather than per dataset because a dataset is only as
 * compliant as its most restrictive asset. One image whose license lapsed last
 * month taints a training run even if the other ten thousand files are clear, so
 * the expiry check has to happen at the level of the individual asset.
 */
export const PERMITTED_USES = ["training", "inference", "evaluation"] as const;
export type PermittedUse = (typeof PERMITTED_USES)[number];

export const PERMITTED_OPERATIONS = ["TRAINING", "INFERENCE", "BOTH", "EVALUATION"] as const;
export type PermittedOperation = (typeof PERMITTED_OPERATIONS)[number];

export type AccountStatus = "ACTIVE" | "RESTRICTED" | "LOCKED";

export interface ViolationPolicyConfig {
    warningThreshold?: number;
    restrictionThreshold?: number;
    lockThreshold?: number;
}

export interface LicenseMetadata {
    /** Stable identifier for the license agreement, unique within a LICENSEIT install. */
    licenseId: string;
    /** Legal entity or person who holds the rights being granted. */
    rightsHolder: string;
    /** What the license actually allows the data to be used for (legacy compatibility). */
    permittedUse: PermittedUse;
    /** ISO 8601 timestamp after which the file may no longer be used. */
    expiresAt: string;
    /** Where the file was lawfully obtained, for example a signed vendor agreement. */
    source: string;

    /** Human-readable dataset name. */
    datasetName?: string;
    /** Dataset description or intended scope. */
    datasetDescription?: string;
    /** ISO 8601 timestamp when the license becomes valid (defaults to upload time). */
    validFrom?: string;
    /** ISO 8601 timestamp when the license lapses (synced with expiresAt). */
    validUntil?: string;
    /** Machine-readable operations permitted: TRAINING, INFERENCE, BOTH, EVALUATION. */
    permittedOperations?: PermittedOperation[];
    /** List of user identifiers authorized to request this dataset. If omitted, open to all active users. */
    authorizedUsers?: string[];
    /** List of organization IDs authorized to access this dataset. If omitted, open to all active organizations. */
    authorizedOrganizations?: string[];
    /** Maximum allowed access status for requests. */
    maxAccessStatus?: string;
    /** Optional specific usage restrictions. */
    usageRestrictions?: string;
    /** Configurable violation thresholds for this dataset. */
    violationPolicy?: ViolationPolicyConfig;
    /** Status of the license agreement itself. */
    status?: "ACTIVE" | "RESTRICTED" | "LOCKED" | "REVOKED";
}

/** One row of the local manifest, joining a stored blob to its license. */
export interface ManifestEntry {
    blobName: string;
    /** Hex blob merkle root returned by Shelby's commitment generation. */
    merkleRoot: string;
    license: LicenseMetadata;
    /** ISO 8601 time the upload completed. */
    uploadedAt: string;
    /** ISO 8601 time the blob itself expires on Shelby, distinct from license expiry. */
    blobExpiresAt: string;
    sizeBytes: number;
}

