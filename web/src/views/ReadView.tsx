import { useState } from "react";
import {
    requestControlledAccess,
    LICENSEITApiError,
    type ControlledAccessSuccess,
} from "../api/LICENSEITApi.js";
import { BusyIndicator, DetailList, ErrorBanner } from "../components/Feedback.js";
import { CopyButton } from "../components/CopyButton.js";
import { VerificationPipeline, VerificationScanner } from "../components/TechVisuals.js";
import type { ViolationEvent } from "../../../src/access/types.js";

export interface ReadViewProps {
    /** Blob names uploaded in this session, offered as a starting point. */
    knownBlobNames: readonly string[];
    initialBlobName?: string;
    onNotify: (message: string) => void;
}

interface FormState {
    blobName: string;
    readerId: string;
    trainingRunId: string;
    operation: "TRAINING" | "INFERENCE";
}

const INITIAL_FORM: FormState = {
    blobName: "customer-data-1mb.csv",
    readerId: "UserA.v1",
    trainingRunId: "sentiment.v1",
    operation: "TRAINING",
};

function determineReasonCode(reason: string, eventType?: string): string {
    if (eventType) return eventType;
    const lower = reason.toLowerCase();
    if (lower.includes("operation") || lower.includes("not permitted for")) {
        return "OPERATION_NOT_PERMITTED";
    }
    if (lower.includes("expire")) {
        return "LICENSE_EXPIRED";
    }
    if (lower.includes("merkle") || lower.includes("root")) {
        return "MERKLE_MISMATCH";
    }
    if (lower.includes("receipt") || lower.includes("aptos")) {
        return "APTOS_RECEIPT_FAILURE";
    }
    return "ACCESS_DENIED_BY_POLICY";
}

export function ReadView({ knownBlobNames, initialBlobName, onNotify }: ReadViewProps) {
    const [form, setForm] = useState<FormState>({
        ...INITIAL_FORM,
        blobName: initialBlobName || INITIAL_FORM.blobName,
    });
    const [busy, setBusy] = useState(false);
    const [deniedReason, setDeniedReason] = useState<string | null>(null);
    const [deniedCode, setDeniedCode] = useState<string | null>(null);
    const [deniedViolation, setDeniedViolation] = useState<ViolationEvent | null>(null);
    const [deniedAccountStatus, setDeniedAccountStatus] = useState<string | null>(null);
    const [failedError, setFailedError] = useState<string | null>(null);
    const [result, setResult] = useState<ControlledAccessSuccess | null>(null);

    const update =
        (field: keyof FormState) =>
            (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
                const val = event.target.value;
                setForm((current) => ({ ...current, [field]: val }));
            };

    function applyPreset(preset: Partial<FormState>): void {
        setForm((curr) => ({ ...curr, ...preset }));
        setDeniedReason(null);
        setDeniedCode(null);
        setDeniedViolation(null);
        setFailedError(null);
        setResult(null);
    }

    async function submit(): Promise<void> {
        setBusy(true);
        setDeniedReason(null);
        setDeniedCode(null);
        setDeniedViolation(null);
        setDeniedAccountStatus(null);
        setFailedError(null);
        setResult(null);

        try {
            const response = await requestControlledAccess({
                blobName: form.blobName,
                readerId: form.readerId,
                trainingRunId: form.trainingRunId,
                operation: form.operation,
            });

            if (response.status === "GRANTED") {
                setResult(response as ControlledAccessSuccess);
                onNotify(`ACCESS GRANTED: ${response.receipt?.blobName} served.`);
            } else {
                const reasonText = response.reason || "Access denied by policy engine.";
                setDeniedReason(reasonText);
                setDeniedCode(determineReasonCode(reasonText, response.eventType));
                if (response.violation) {
                    setDeniedViolation(response.violation);
                }
                if (response.accountStatus) {
                    setDeniedAccountStatus(response.accountStatus);
                }
            }
        } catch (cause) {
            if (cause instanceof LICENSEITApiError) {
                if (cause.status === 403) {
                    setDeniedReason(cause.message);
                    setDeniedCode(determineReasonCode(cause.message, cause.eventType));
                    if (cause.violation) {
                        setDeniedViolation(cause.violation);
                    }
                    if (cause.accountStatus) {
                        setDeniedAccountStatus(cause.accountStatus);
                    }
                } else {
                    setFailedError(cause.message);
                }
            } else {
                setFailedError(cause instanceof Error ? cause.message : "The request failed before reaching LicenNode.");
            }
        } finally {
            setBusy(false);
        }
    }

    // Determine pipeline failure stage index
    let failedStageIndex = 0;
    if (deniedCode === "OPERATION_NOT_PERMITTED") {
        failedStageIndex = 1;
    } else if (deniedCode === "MERKLE_MISMATCH") {
        failedStageIndex = 2;
    } else if (deniedCode === "APTOS_RECEIPT_FAILURE") {
        failedStageIndex = 3;
    } else {
        failedStageIndex = 0; // License check (expired, validity)
    }

    const pipelineState = busy
        ? "busy"
        : result
          ? "success"
          : deniedReason
            ? "denied"
            : "idle";

    return (
        <div className="view-container">
            {/* Header */}
            <section className="tech-page-header">
                <div className="tech-header-meta">
                    <span className="tech-eyebrow">MODULE 03 // CONTROLLED DATA ACCESS &amp; ZERO-TRUST ENFORCEMENT</span>
                    <span className="tech-badge tech-badge--neon">RUNTIME POLICY GATEWAY</span>
                </div>
                <h1 className="tech-page-title">Controlled Access Evaluation Terminal</h1>
                <p className="tech-page-desc">
                    Access is governed by dataset license policy, not by a user/organization allowlist. LicenNode evaluates license validity, operation type (TRAINING vs INFERENCE), and dataset integrity before retrieving bytes from Shelby.
                </p>

                {/* 5-Step Verification Sequence Pipeline */}
                <VerificationPipeline step={pipelineState} failedStageIndex={failedStageIndex} />
            </section>

            {/* License-Governed Access Callout Banner */}
            <div className="tech-card" style={{ marginBottom: "1.25rem", background: "var(--bg-surface)", borderLeft: "4px solid var(--accent-neon)" }}>
                <div style={{ padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span className="material-symbols-outlined" style={{ color: "var(--accent-neon-dark)", fontSize: "20px" }}>
                        info
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-main)", fontWeight: 600 }}>
                        POLICY GOVERNANCE: Anyone can request access to this dataset. The zero-trust gate verifies that the request satisfies the machine-readable license terms (permitted operation &amp; validity bounds).
                    </span>
                </div>
            </div>

            {/* Quick Demo Scenarios Bar */}
            <div className="tech-card tech-card--scenarios">
                <div className="tech-scenarios-bar">
                    <span className="tech-mono tech-scenarios-label">
                        POLICY DEMO PRESETS:
                    </span>
                    <button
                        type="button"
                        className="tech-preset-btn tech-preset-btn--success"
                        onClick={() =>
                            applyPreset({
                                blobName: "customer-data-1mb.csv",
                                readerId: "UserA.v1",
                                trainingRunId: "sentiment.v1",
                                operation: "TRAINING",
                            })
                        }
                    >
                        [✓] User A: Training (Allowed)
                    </button>

                    <button
                        type="button"
                        className="tech-preset-btn tech-preset-btn--success"
                        onClick={() =>
                            applyPreset({
                                blobName: "customer-data-1mb.csv",
                                readerId: "UserB.v2",
                                trainingRunId: "sentiment.v1",
                                operation: "TRAINING",
                            })
                        }
                    >
                        [✓] User B: Training (Allowed)
                    </button>

                    <button
                        type="button"
                        className="tech-preset-btn tech-preset-btn--danger"
                        onClick={() =>
                            applyPreset({
                                blobName: "customer-data-1mb.csv",
                                readerId: "UserA.v1",
                                trainingRunId: "sentiment.v1",
                                operation: "INFERENCE",
                            })
                        }
                    >
                        [▲] User A: Inference (Denied — Training Only)
                    </button>

                    <button
                        type="button"
                        className="tech-preset-btn tech-preset-btn--warning"
                        onClick={() =>
                            applyPreset({
                                blobName: "expired-dataset.txt",
                                readerId: "UserC.v3",
                                trainingRunId: "expired-run.v1",
                                operation: "TRAINING",
                            })
                        }
                    >
                        [▲] Expired License (Denied)
                    </button>
                </div>
            </div>

            {/* Access Request Form Card */}
            <div className="tech-card">
                <div className="tech-card-header">
                    <div className="tech-card-header-left">
                        <span className="tech-card-tag">[ACCESS REQUEST SPECIFICATION]</span>
                        <h3 className="tech-card-title">Controlled Access Request</h3>
                    </div>
                    <span className="tech-card-sub">ZERO-TRUST POLICY GATEWAY</span>
                </div>

                <div className="tech-card-body">
                    <div className="tech-field-grid">
                        {/* Blob name */}
                        <div className="tech-field">
                            <div className="tech-field-label-row">
                                <label htmlFor="blobName" className="tech-label">Dataset / Storage Name</label>
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
                            <span className="tech-help-text">Blob name in Shelby storage namespace</span>
                        </div>

                        {/* Requested Operation (Training vs Inference) */}
                        <div className="tech-field">
                            <div className="tech-field-label-row">
                                <label htmlFor="operation" className="tech-label">Requested Operation</label>
                                <span className="tech-badge tech-badge--purple">
                                    ENFORCED POLICY
                                </span>
                            </div>
                            <div className="tech-select-wrap">
                                <select
                                    id="operation"
                                    className="tech-select tech-mono"
                                    value={form.operation}
                                    onChange={update("operation")}
                                    style={{ fontWeight: 700 }}
                                >
                                    <option value="TRAINING">TRAINING — Supervised Fine-Tuning / Pretraining</option>
                                    <option value="INFERENCE">INFERENCE — Model Serving / Execution</option>
                                </select>
                                <span className="tech-select-arrow" aria-hidden="true">▼</span>
                            </div>
                            <span className="tech-help-text">
                                LicenNode enforces permittedOperations before retrieving any bytes from Shelby.
                            </span>
                        </div>
                    </div>

                    <div className="tech-field-grid">
                        {/* Training run ID */}
                        <div className="tech-field">
                            <div className="tech-field-label-row">
                                <label htmlFor="trainingRunId" className="tech-label">Training Run / Purpose ID</label>
                                <span className="tech-required-tag">REQUIRED</span>
                            </div>
                            <div className="tech-input-wrap">
                                <input
                                    id="trainingRunId"
                                    className="tech-input tech-mono"
                                    value={form.trainingRunId}
                                    required
                                    maxLength={512}
                                    placeholder="e.g. sentiment.v1"
                                    onChange={update("trainingRunId")}
                                />
                            </div>
                            <span className="tech-help-text">Audit trail run identifier for compliance attestation</span>
                        </div>

                        {/* Reader ID (Metadata) */}
                        <div className="tech-field">
                            <div className="tech-field-label-row">
                                <label htmlFor="readerId" className="tech-label">Reader Identity (Provenance Metadata)</label>
                                <span className="tech-badge-tag">METADATA</span>
                            </div>
                            <div className="tech-input-wrap">
                                <input
                                    id="readerId"
                                    className="tech-input tech-mono"
                                    value={form.readerId}
                                    maxLength={512}
                                    placeholder="e.g. UserA.v1"
                                    onChange={update("readerId")}
                                />
                            </div>
                            <span className="tech-help-text">Recorded for immutable audit logging; not an allowlist requirement</span>
                        </div>
                    </div>

                    {/* Known Blobs Session Chips */}
                    {knownBlobNames.length > 0 && (
                        <div className="tech-chips-section">
                            <span className="tech-chips-label">Uploaded in this session:</span>
                            <div className="tech-chips-list">
                                {knownBlobNames.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        className="tech-chip"
                                        onClick={() => setForm((current) => ({ ...current, blobName: name }))}
                                    >
                                        <span className="tech-chip-prefix">[+]</span>
                                        <span className="tech-chip-name">{name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* General Failure Error Banner */}
            {failedError && <ErrorBanner title="Request Error" message={failedError} />}
            {busy && <BusyIndicator label="Evaluating machine-readable license policy, verifying Merkle proof, and anchoring Aptos receipt..." />}

            {/* Action Row */}
            <div className="tech-actions-bar" style={{ margin: "1.5rem 0" }}>
                <button
                    type="button"
                    className="tech-btn tech-btn--primary tech-btn--large"
                    disabled={busy}
                    onClick={submit}
                >
                    <span className="material-symbols-outlined tech-btn-icon" aria-hidden="true">
                        shield_lock
                    </span>
                    REQUEST DATASET ACCESS
                </button>
            </div>

            {/* ========================================================
                PROMINENT ACCESS DENIED / FETCH FAILED CARD (RED)
                ======================================================== */}
            {deniedReason && (
                <div className="tech-denial-card" role="alert">
                    <div className="tech-denial-header">
                        <div className="tech-denial-title-group">
                            <span className="tech-badge tech-badge--error-large">
                                ▲ ACCESS DENIED
                            </span>
                            <h2 className="tech-denial-title">
                                FETCH FAILED // DATASET NOT RELEASED
                            </h2>
                        </div>
                        <span className="tech-badge tech-badge--failclosed">
                            ZERO-TRUST FAIL-CLOSED
                        </span>
                    </div>

                    <div className="tech-denial-body">
                        {/* Prominent Exact Reason Code Banner */}
                        <div className="tech-denial-code-box">
                            <span className="tech-denial-code-label">REASON CODE:</span>
                            <span className="tech-mono tech-denial-code-val">
                                {deniedCode ?? "OPERATION_NOT_PERMITTED"}
                            </span>
                        </div>

                        <div className="tech-denial-message">
                            {deniedReason}
                        </div>

                        {deniedViolation && (
                            <div className="tech-denial-details">
                                <DetailList
                                    rows={[
                                        { label: "Violation type", value: deniedViolation.eventType },
                                        { label: "Dataset target", value: deniedViolation.dataset },
                                        { label: "Reader identity", value: deniedViolation.readerId },
                                        { label: "Requested operation", value: deniedViolation.requestedOperation },
                                        {
                                            label: "Permitted operations",
                                            value: deniedViolation.allowedOperations.join(", ") || "None",
                                        },
                                        { label: "Enforcement action", value: deniedViolation.action },
                                        {
                                            label: "Account status after",
                                            value: deniedAccountStatus ?? deniedViolation.accountStatusAfter,
                                        },
                                    ]}
                                />
                            </div>
                        )}

                        {/* Security Guarantee Box */}
                        <div className="tech-security-guarantee">
                            <span className="tech-guarantee-badge">SECURITY GUARANTEE: ZERO BYTES RELEASED</span>
                            <p className="tech-guarantee-text">
                                Under zero-trust architecture, the dataset bytes were <strong>NEVER</strong> fetched from Shelby or returned to the client. This violation event has been logged to the on-chain audit and compliance dashboard.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================================
                PROMINENT ACCESS GRANTED RESULT DISPLAY (NEON GREEN)
                ======================================================== */}
            {result && (
                <div className="tech-card tech-card--result tech-card--granted">
                    <VerificationScanner active={true} />
                    <div className="tech-card-header tech-card-header--verified">
                        <div className="tech-card-header-left">
                            <span className="tech-badge tech-badge--success-large">
                                ✓ ACCESS GRANTED
                            </span>
                            <div className="tech-granted-titles">
                                <h2 className="tech-card-title">
                                    DATA FETCH SUCCESSFUL // DATASET SERVED
                                </h2>
                            </div>
                        </div>
                        <div className="tech-card-header-right">
                            <span className="tech-tag tech-tag--accent tech-mono">
                                APTOS VERIFIED // {result.receipt.blobName}
                            </span>
                        </div>
                    </div>

                    <div className="tech-card-body">
                        {/* 5-Step Verification Checklist */}
                        <div className="tech-five-checklist">
                            <div className="tech-checklist-item">
                                <div className="tech-checklist-num">01</div>
                                <div className="tech-checklist-content">
                                    <span className="tech-checklist-title">✓ LICENSE VERIFIED</span>
                                    <span className="tech-checklist-sub">
                                        Valid until {new Date(result.license.expiresAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                            <div className="tech-checklist-item">
                                <div className="tech-checklist-num">02</div>
                                <div className="tech-checklist-content">
                                    <span className="tech-checklist-title">✓ OPERATION AUTHORIZED</span>
                                    <span className="tech-checklist-sub">
                                        {form.operation} permitted
                                    </span>
                                </div>
                            </div>
                            <div className="tech-checklist-item">
                                <div className="tech-checklist-num">03</div>
                                <div className="tech-checklist-content">
                                    <span className="tech-checklist-title">✓ MERKLE VERIFIED</span>
                                    <span className="tech-checklist-sub">
                                        SHA-256 chunk match
                                    </span>
                                </div>
                            </div>
                            <div className="tech-checklist-item">
                                <div className="tech-checklist-num">04</div>
                                <div className="tech-checklist-content">
                                    <span className="tech-checklist-title">✓ APTOS ANCHORED</span>
                                    <span className="tech-checklist-sub">
                                        Immutable receipt log
                                    </span>
                                </div>
                            </div>
                            <div className="tech-checklist-item">
                                <div className="tech-checklist-num">05</div>
                                <div className="tech-checklist-content">
                                    <span className="tech-checklist-title">✓ DATASET SERVED</span>
                                    <span className="tech-checklist-sub">
                                        {result.contentBytes ?? result.receipt.servedBytes} bytes delivered
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Interactive Served Data Preview Window */}
                        {result.data && (
                            <div className="tech-stream-box">
                                <div className="tech-stream-header">
                                    <span className="tech-mono tech-stream-title">
                                        SERVED DATASET STREAM // {result.receipt.blobName}
                                    </span>
                                    <CopyButton text={result.data} label="COPY STREAM" />
                                </div>
                                <pre className="tech-mono tech-stream-pre">
                                    {result.isText
                                        ? result.data
                                        : `[Binary Base64 Payload: ${result.data.slice(0, 300)}...]`}
                                </pre>
                            </div>
                        )}

                        {/* Receipt Detailed Breakdown */}
                        <DetailList
                            rows={[
                                { label: "Dataset / Blob", value: result.receipt.blobName },
                                { label: "Merkle root", value: result.receipt.merkleRoot, mono: true },
                                {
                                    label: "Merkle verification",
                                    value: "PASS (Recomputed root matches Shelby upload commitment)",
                                },
                                { label: "Content SHA-256", value: result.receipt.contentSha256, mono: true },
                                { label: "Served bytes", value: `${result.receipt.servedBytes} bytes` },
                                { label: "License ID", value: result.license.licenseId },
                                { label: "Rights holder", value: result.license.rightsHolder },
                                {
                                    label: "Permitted operations",
                                    value: result.license.permittedOperations?.join(", ") ?? result.license.permittedUse,
                                },
                                { label: "Reader / Run", value: `${form.readerId} // ${form.trainingRunId}` },
                            ]}
                        />

                        {/* Aptos Explorer Transaction Link Box */}
                        <div className="tech-tx-box">
                            <div className="tech-tx-header">
                                <span className="tech-tx-label">
                                    Anchored on Aptos in transaction{" "}
                                </span>
                                <CopyButton text={result.receiptLogTransactionHash} />
                            </div>
                            <div className="tech-tx-row">
                                <a
                                    className="tech-explorer-link tech-mono"
                                    href={result.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                >
                                    <span className="tech-tx-hash">{result.receiptLogTransactionHash}</span>
                                    <span className="material-symbols-outlined tech-link-icon" aria-hidden="true">
                                        open_in_new
                                    </span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
