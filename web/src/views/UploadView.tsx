import { useRef, useState } from "react";
import type { ManifestEntry } from "../../../src/licenses/schema.js";
import {
    fileToBase64,
    uploadLicensedFileRequest,
    LICENSEITApiError,
} from "../api/LICENSEITApi.js";
import { BusyIndicator, DetailList, ErrorBanner } from "../components/Feedback.js";
import { CopyButton } from "../components/CopyButton.js";
import { VerificationScanner } from "../components/TechVisuals.js";

export interface UploadViewProps {
    onUploaded: (entry: ManifestEntry) => void;
    onNotify: (message: string) => void;
}

interface FormState {
    blobName: string;
    datasetName: string;
    datasetDescription: string;
    licenseId: string;
    rightsHolder: string;
    permittedOp: "TRAINING" | "INFERENCE" | "BOTH";
    validFrom: string;
    expiresAt: string;
    source: string;
    usageRestrictions: string;
    expirationDays: string;
}

function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function defaultExpiry(): string {
    const oneYearOut = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return oneYearOut.toISOString().slice(0, 10);
}

const INITIAL_FORM: FormState = {
    blobName: "customer-data-1mb.csv",
    datasetName: "customer-data-1mb.csv",
    datasetDescription: "High-value customer interaction dataset for AI fine-tuning",
    licenseId: "LIC-2026-CUSTOMER-001",
    rightsHolder: "BV Data providers INC",
    permittedOp: "TRAINING",
    validFrom: todayDate(),
    expiresAt: defaultExpiry(),
    source: "BV Data providers INC direct license agreement",
    usageRestrictions: "Authorized for sentiment classifier fine-tuning only. Model weights distribution permitted.",
    expirationDays: "30",
};

export function UploadView({ onUploaded, onNotify }: UploadViewProps) {
    const [form, setForm] = useState<FormState>(INITIAL_FORM);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [entry, setEntry] = useState<ManifestEntry | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const update =
        (field: keyof FormState) =>
            (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => {
                const val = event.target.value;
                setForm((current) => ({ ...current, [field]: val }));
            };

    async function submit(): Promise<void> {
        if (!file) {
            setError("Choose a dataset file to upload and register.");
            return;
        }
        setBusy(true);
        setError(null);
        setEntry(null);

        const permittedOperations =
            form.permittedOp === "BOTH" ? ["TRAINING", "INFERENCE"] : [form.permittedOp];
        const permittedUse = form.permittedOp === "INFERENCE" ? "inference" : "training";

        try {
            const response = await uploadLicensedFileRequest({
                blobName: form.blobName,
                fileName: file.name,
                fileBase64: await fileToBase64(file),
                expirationDays: Number(form.expirationDays),
                licenseId: form.licenseId,
                rightsHolder: form.rightsHolder,
                permittedUse,
                expiresAt: new Date(`${form.expiresAt}T23:59:59.000Z`).toISOString(),
                source: form.source,
                datasetName: form.datasetName,
                datasetDescription: form.datasetDescription,
                validFrom: new Date(`${form.validFrom}T00:00:00.000Z`).toISOString(),
                validUntil: new Date(`${form.expiresAt}T23:59:59.000Z`).toISOString(),
                permittedOperations,
                usageRestrictions: form.usageRestrictions,
            });
            setEntry(response.entry);
            onUploaded(response.entry);
            onNotify(`Successfully uploaded & registered: ${response.entry.blobName}`);
        } catch (cause) {
            setError(
                cause instanceof LICENSEITApiError
                    ? cause.message
                    : "The upload failed before it reached Shelby storage.",
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="view-container">
            {/* Header */}
            <section className="tech-page-header">
                <div className="tech-header-meta">
                    <span className="tech-eyebrow">MODULE 02 // DATA INGEST &amp; ASSET REGISTRATION</span>
                    <span className="tech-badge tech-badge--neon">IMMUTABLE ASSET ONBOARDING</span>
                </div>
                <h1 className="tech-page-title">Register Licensed Digital Asset</h1>
                <p className="tech-page-desc">
                    Uploading a dataset registers a legally protected, machine-readable digital asset in the Shelby decentralized vault with cryptographic Merkle proof commitment. Access is governed by license policy terms rather than identity allowlists.
                </p>

                {/* Technical visual pipeline indicator */}
                <div className="tech-mini-pipeline">
                    <div className="tech-mini-step">
                        <span className="tech-mini-num">01</span>
                        <span className="tech-mini-txt">DATASET &amp; BLOB SPECIFICATION</span>
                    </div>
                    <span className="tech-mini-arrow">→</span>
                    <div className="tech-mini-step">
                        <span className="tech-mini-num">02</span>
                        <span className="tech-mini-txt">LICENSE PROVENANCE</span>
                    </div>
                    <span className="tech-mini-arrow">→</span>
                    <div className="tech-mini-step">
                        <span className="tech-mini-num">03</span>
                        <span className="tech-mini-txt">USAGE POLICY SPECIFICATION</span>
                    </div>
                    <span className="tech-mini-arrow">→</span>
                    <div className="tech-mini-step">
                        <span className="tech-mini-num">04</span>
                        <span className="tech-mini-txt">MERKLE COMMITMENT &amp; SHELBY VAULT</span>
                    </div>
                </div>
            </section>

            {/* Form Sections */}
            <div className="tech-form-layout">
                {/* 01 DATASET */}
                <div className="tech-card">
                    <div className="tech-card-header">
                        <div className="tech-card-header-left">
                            <span className="tech-section-index">01</span>
                            <span className="tech-card-tag">[STORAGE ASSET]</span>
                            <h3 className="tech-card-title">DATASET</h3>
                        </div>
                        <span className="tech-card-sub">FILE &amp; NAMESPACE SPECIFICATION</span>
                    </div>

                    <div className="tech-card-body">
                        {/* Custom Technical File Dropzone */}
                        <div className="tech-file-zone">
                            <input
                                ref={fileInputRef}
                                id="file-upload-input"
                                className="tech-hidden-input"
                                type="file"
                                aria-label="Data file to upload"
                                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                            />
                            <label htmlFor="file-upload-input" className="tech-file-drop">
                                <span className="material-symbols-outlined tech-file-icon" aria-hidden="true">
                                    upload_file
                                </span>
                                <div className="tech-file-info">
                                    {file ? (
                                        <>
                                            <span className="tech-file-name">{file.name}</span>
                                            <span className="tech-file-meta">
                                                {(file.size / 1024).toFixed(2)} KB // READY FOR SHA-256 MERKLE GENERATION
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="tech-file-prompt">Select dataset file to upload</span>
                                            <span className="tech-file-sub">CLICK TO BROWSE LOCAL FILESYSTEM OR DROP FILE</span>
                                        </>
                                    )}
                                </div>
                                <span className="tech-file-btn">
                                    {file ? "CHANGE FILE" : "BROWSE FILE"}
                                </span>
                            </label>
                        </div>

                        <div className="tech-field-grid">
                            {/* Blob name */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="blobName" className="tech-label">Blob / Storage Name</label>
                                    <span className="tech-required-tag">REQUIRED</span>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="blobName"
                                        className="tech-input tech-mono"
                                        value={form.blobName}
                                        required
                                        maxLength={512}
                                        placeholder="e.g. customer-data-1mb.csv"
                                        onChange={update("blobName")}
                                    />
                                </div>
                                <span className="tech-help-text">Unique asset name in Shelby storage namespace</span>
                            </div>

                            {/* Blob lifetime in days */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="expirationDays" className="tech-label">Blob Lifetime (Days)</label>
                                    <span className="tech-badge-tag">SHELBY</span>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="expirationDays"
                                        type="number"
                                        className="tech-input tech-mono"
                                        value={form.expirationDays}
                                        min="1"
                                        max="30"
                                        onChange={update("expirationDays")}
                                    />
                                </div>
                                <span className="tech-help-text">Retention duration in Shelby decentralized storage</span>
                            </div>
                        </div>

                        <div className="tech-field-grid">
                            {/* Dataset Name */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="datasetName" className="tech-label">Dataset Name</label>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="datasetName"
                                        className="tech-input"
                                        value={form.datasetName}
                                        placeholder="e.g. customer-data-1mb.csv"
                                        onChange={update("datasetName")}
                                    />
                                </div>
                            </div>

                            {/* Dataset Description */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="datasetDescription" className="tech-label">Dataset Description</label>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="datasetDescription"
                                        className="tech-input"
                                        value={form.datasetDescription}
                                        placeholder="e.g. High-value customer interaction dataset for AI fine-tuning"
                                        onChange={update("datasetDescription")}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 02 LICENSE */}
                <div className="tech-card">
                    <div className="tech-card-header">
                        <div className="tech-card-header-left">
                            <span className="tech-section-index">02</span>
                            <span className="tech-card-tag">[LEGAL PROVENANCE]</span>
                            <h3 className="tech-card-title">LICENSE</h3>
                        </div>
                        <span className="tech-card-sub">RIGHTS HOLDER &amp; PROVENANCE GRANT</span>
                    </div>

                    <div className="tech-card-body">
                        <div className="tech-field-grid">
                            {/* License ID */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="licenseId" className="tech-label">License ID</label>
                                    <span className="tech-required-tag">REQUIRED</span>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="licenseId"
                                        className="tech-input tech-mono"
                                        value={form.licenseId}
                                        required
                                        maxLength={512}
                                        placeholder="e.g. LIC-2026-CUSTOMER-001"
                                        onChange={update("licenseId")}
                                    />
                                </div>
                                <span className="tech-help-text">Machine-readable license contract identifier</span>
                            </div>

                            {/* Rights holder */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="rightsHolder" className="tech-label">Rights Holder</label>
                                    <span className="tech-required-tag">REQUIRED</span>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="rightsHolder"
                                        className="tech-input"
                                        value={form.rightsHolder}
                                        required
                                        maxLength={512}
                                        placeholder="e.g. BV Data providers INC"
                                        onChange={update("rightsHolder")}
                                    />
                                </div>
                                <span className="tech-help-text">Legal entity owning dataset copyrights</span>
                            </div>
                        </div>

                        {/* Source */}
                        <div className="tech-field">
                            <div className="tech-field-label-row">
                                <label htmlFor="source" className="tech-label">Source &amp; Provenance Agreement</label>
                                <span className="tech-required-tag">REQUIRED</span>
                            </div>
                            <div className="tech-input-wrap">
                                <input
                                    id="source"
                                    className="tech-input"
                                    value={form.source}
                                    required
                                    maxLength={512}
                                    placeholder="e.g. BV Data providers INC direct license agreement"
                                    onChange={update("source")}
                                />
                            </div>
                            <span className="tech-help-text">Legal chain of custody and provenance documentation</span>
                        </div>
                    </div>
                </div>

                {/* 03 USAGE POLICY */}
                <div className="tech-card">
                    <div className="tech-card-header">
                        <div className="tech-card-header-left">
                            <span className="tech-section-index">03</span>
                            <span className="tech-card-tag">[OPERATION RULES]</span>
                            <h3 className="tech-card-title">USAGE POLICY</h3>
                        </div>
                        <span className="tech-card-sub">PERMITTED OPERATIONS &amp; VALIDITY BOUNDS</span>
                    </div>

                    <div className="tech-card-body">
                        <div className="tech-field-grid">
                            {/* Permitted Operations */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="permittedOp" className="tech-label">Permitted Operation</label>
                                    <span className="tech-badge-tag" style={{ background: "var(--accent-neon)", color: "#111111", fontWeight: 700 }}>
                                        ENFORCED
                                    </span>
                                </div>
                                <div className="tech-select-wrap">
                                    <select
                                        id="permittedOp"
                                        className="tech-select tech-mono"
                                        value={form.permittedOp}
                                        onChange={update("permittedOp")}
                                    >
                                        <option value="TRAINING">TRAINING (Training only — Inference strictly forbidden)</option>
                                        <option value="INFERENCE">INFERENCE (Inference only — Training strictly forbidden)</option>
                                        <option value="BOTH">BOTH (Both Training and Inference allowed)</option>
                                    </select>
                                    <span className="tech-select-arrow" aria-hidden="true">▼</span>
                                </div>
                                <span className="tech-help-text">Policy rule enforced at runtime before data retrieval</span>
                            </div>

                            {/* License Expiration Dates */}
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="expiresAt" className="tech-label">Valid Until (Expiration Date)</label>
                                    <span className="tech-required-tag">REQUIRED</span>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="expiresAt"
                                        type="date"
                                        className="tech-input tech-mono"
                                        value={form.expiresAt}
                                        required
                                        onChange={update("expiresAt")}
                                    />
                                </div>
                                <span className="tech-help-text">Requests after this timestamp fail closed</span>
                            </div>
                        </div>

                        <div className="tech-field-grid">
                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="validFrom" className="tech-label">Valid From Date</label>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="validFrom"
                                        type="date"
                                        className="tech-input tech-mono"
                                        value={form.validFrom}
                                        onChange={update("validFrom")}
                                    />
                                </div>
                                <span className="tech-help-text">Effective start date of license rights</span>
                            </div>

                            <div className="tech-field">
                                <div className="tech-field-label-row">
                                    <label htmlFor="usageRestrictions" className="tech-label">Usage Restrictions &amp; Policy Bounds</label>
                                </div>
                                <div className="tech-input-wrap">
                                    <input
                                        id="usageRestrictions"
                                        className="tech-input"
                                        value={form.usageRestrictions}
                                        placeholder="e.g. Authorized for sentiment classifier fine-tuning only. Model weights distribution permitted."
                                        onChange={update("usageRestrictions")}
                                    />
                                </div>
                                <span className="tech-help-text">Contractual scope restrictions</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 04 INTEGRITY & STORAGE */}
                <div className="tech-card">
                    <div className="tech-card-header">
                        <div className="tech-card-header-left">
                            <span className="tech-section-index">04</span>
                            <span className="tech-card-tag">[STORAGE &amp; MERKLE ENGINE]</span>
                            <h3 className="tech-card-title">INTEGRITY &amp; STORAGE</h3>
                        </div>
                        <span className="tech-card-sub">CRYPTOGRAPHIC COMMITMENT &amp; VAULT DISPATCH</span>
                    </div>

                    <div className="tech-card-body">
                        <div className="tech-summary-grid">
                            <div className="tech-summary-box">
                                <span className="tech-summary-lbl">STORAGE ENGINE</span>
                                <span className="tech-summary-val">SHELBY DECENTRALIZED VAULT</span>
                                <span className="tech-summary-sub">Encrypted Blob Stream</span>
                            </div>
                            <div className="tech-summary-box">
                                <span className="tech-summary-lbl">CRYPTOGRAPHIC PROOF</span>
                                <span className="tech-summary-val">SHA-256 MERKLE ROOT</span>
                                <span className="tech-summary-sub">Pre-flight Chunk Commitment</span>
                            </div>
                            <div className="tech-summary-box">
                                <span className="tech-summary-lbl">ACCESS MODEL</span>
                                <span className="tech-summary-val">LICENSE-POLICY GOVERNED</span>
                                <span className="tech-summary-sub">Open to Any Compliant Request</span>
                            </div>
                        </div>

                        {/* Error & Busy Feedback */}
                        {error && <ErrorBanner title="Asset Registration Failed" message={error} />}
                        {busy && <BusyIndicator label="Uploading blob to Shelby vault & calculating cryptographic Merkle commitment..." />}

                        {/* Action Buttons */}
                        <div className="tech-actions-bar" style={{ marginTop: "1.2rem" }}>
                            <button
                                type="button"
                                className="tech-btn tech-btn--primary"
                                disabled={busy}
                                onClick={submit}
                            >
                                <span className="material-symbols-outlined tech-btn-icon" aria-hidden="true">
                                    cloud_upload
                                </span>
                                Register Dataset with Policy
                            </button>

                            <button
                                type="button"
                                className="tech-btn tech-btn--outline"
                                disabled={busy}
                                onClick={() => {
                                    setForm(INITIAL_FORM);
                                    setFile(null);
                                    setEntry(null);
                                    setError(null);
                                    if (fileInputRef.current) {
                                        fileInputRef.current.value = "";
                                    }
                                }}
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stored License Manifest Summary Card — Strong Verification/Result Panel */}
            {entry && (
                <div className="tech-card tech-card--result" style={{ marginTop: "2rem" }}>
                    <VerificationScanner active={true} />
                    <div className="tech-card-header tech-card-header--verified">
                        <div className="tech-card-header-left">
                            <span className="tech-badge tech-badge--success" style={{ fontSize: "0.82rem", padding: "4px 10px" }}>
                                ✓ UPLOAD SUCCESSFUL
                            </span>
                            <h3 className="tech-card-title" style={{ marginLeft: "0.5rem" }}>
                                Digital Asset Registered &amp; Protected
                            </h3>
                        </div>
                        <div className="tech-card-header-right">
                            <span className="tech-tag tech-tag--accent tech-mono">
                                SHELBY BLOB: {entry.blobName}
                            </span>
                        </div>
                    </div>

                    <div className="tech-card-body">
                        {/* 4-Item Verification Status Grid */}
                        <div className="tech-verification-four-grid">
                            <div className="tech-verify-card">
                                <div className="tech-verify-check">✓</div>
                                <div className="tech-verify-text">
                                    <span className="tech-verify-title">Shelby Storage</span>
                                    <span className="tech-verify-desc">Stored in decentralized vault</span>
                                </div>
                            </div>
                            <div className="tech-verify-card">
                                <div className="tech-verify-check">✓</div>
                                <div className="tech-verify-text">
                                    <span className="tech-verify-title">License Registered</span>
                                    <span className="tech-verify-desc">Active machine-readable policy</span>
                                </div>
                            </div>
                            <div className="tech-verify-card">
                                <div className="tech-verify-check">✓</div>
                                <div className="tech-verify-text">
                                    <span className="tech-verify-title">Merkle Root Generated</span>
                                    <span className="tech-verify-desc">Cryptographic chunk commitment</span>
                                </div>
                            </div>
                            <div className="tech-verify-card">
                                <div className="tech-verify-check">✓</div>
                                <div className="tech-verify-text">
                                    <span className="tech-verify-title">Dataset Protected</span>
                                    <span className="tech-verify-desc">Zero-trust gate active</span>
                                </div>
                            </div>
                        </div>

                        {/* Highlighted Merkle Root Banner */}
                        <div className="tech-highlight-block">
                            <div className="tech-highlight-header">
                                <span className="tech-highlight-label">CRYPTOGRAPHIC MERKLE ROOT</span>
                                <CopyButton text={entry.merkleRoot} />
                            </div>
                            <div className="tech-highlight-code tech-mono">{entry.merkleRoot}</div>
                            <span className="tech-highlight-note">
                                Computed from sha256 chunks — serves as immutable integrity reference for every read
                            </span>
                        </div>

                        {/* Complete Manifest Details */}
                        <DetailList
                            rows={[
                                { label: "Dataset name", value: entry.blobName },
                                { label: "Merkle root", value: entry.merkleRoot, mono: true },
                                { label: "Size", value: `${entry.sizeBytes} bytes` },
                                { label: "License ID", value: entry.license.licenseId },
                                { label: "Rights holder", value: entry.license.rightsHolder },
                                {
                                    label: "Permitted operations",
                                    value: entry.license.permittedOperations?.join(", ") ?? entry.license.permittedUse,
                                },
                                { label: "Valid until", value: entry.license.expiresAt },
                                { label: "Shelby retention", value: entry.blobExpiresAt },
                                { label: "Source", value: entry.license.source },
                            ]}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
