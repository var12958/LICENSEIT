import { useState } from "react";
import type { ReportedRead, ReadVerdict } from "../../../src/audit/reportGenerator.js";
import { fetchAuditReport, LICENSEITApiError, type AuditResponse } from "../api/LICENSEITApi.js";
import { BusyIndicator, DetailList, ErrorBanner } from "../components/Feedback.js";
import { CopyButton } from "../components/CopyButton.js";
import { TrustScoreMeter, VerificationScanner } from "../components/TechVisuals.js";

export interface AuditViewProps {
    onNotify: (message: string) => void;
}

const VERDICT_LABEL: Record<ReadVerdict, string> = {
    compliant: "Licensed at read time",
    "expired-at-read": "License had expired",
    unlicensed: "Use not permitted",
    "unknown-blob": "Blob not in the manifest",
};

function CompliantReadCard({ read, explorerUrl }: { read: ReportedRead; explorerUrl?: string }) {
    return (
        <div className="tech-event-card tech-event-card--compliant">
            <div className="tech-event-header">
                <div className="tech-event-header-left">
                    <span className="tech-badge tech-badge--success">
                        ✓ COMPLIANT
                    </span>
                    <span className="tech-badge tech-badge--outline">
                        ACCESS GRANTED
                    </span>
                    <span className="tech-badge tech-badge--neon">
                        APTOS ANCHORED
                    </span>
                    <h4 className="tech-event-title tech-mono">{read.blobName ?? "Unknown blob"}</h4>
                </div>
                <span className="tech-event-timestamp tech-mono">
                    {new Date(read.timestamp).toLocaleString()}
                </span>
            </div>

            <div className="tech-event-body">
                <div className="tech-event-meta-grid">
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">DATASET</span>
                        <span className="tech-meta-val tech-mono">{read.blobName ?? "N/A"}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">LICENSE ID</span>
                        <span className="tech-meta-val tech-mono">{read.licenseId}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">READER</span>
                        <span className="tech-meta-val tech-mono tech-highlight-reader">{read.reader}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">OPERATION</span>
                        <span className="tech-meta-val tech-badge tech-badge--cyan">{read.operation ?? "TRAINING"}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">MERKLE STATUS</span>
                        <span className="tech-meta-val tech-text-success">VERIFIED MATCH (SHA-256)</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">VERDICT</span>
                        <span className="tech-meta-val tech-text-success">{VERDICT_LABEL[read.verdict]}</span>
                    </div>
                </div>

                <div className="tech-event-hashes">
                    <div className="tech-hash-row">
                        <span className="tech-hash-lbl">BLOB HASH / MERKLE:</span>
                        <span className="tech-mono tech-hash-str">{read.blobHash}</span>
                        <CopyButton text={read.blobHash} />
                    </div>
                </div>

                {explorerUrl && (
                    <div className="tech-event-footer">
                        <span className="tech-footer-tx-lbl">APTOS ON-CHAIN RECEIPT:</span>
                        <a
                            className="tech-explorer-link tech-mono"
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            <span className="tech-tx-hash">{read.transactionHash}</span>
                            <span className="material-symbols-outlined tech-link-icon" aria-hidden="true">
                                open_in_new
                            </span>
                        </a>
                        <CopyButton text={read.transactionHash} label="COPY TX" />
                    </div>
                )}
            </div>
        </div>
    );
}

function BlockedEventCard({
    blocked,
}: {
    blocked: {
        dataset: string;
        reader: string;
        organization?: string;
        requestedOperation: string;
        action: string;
        reason: string;
        timestamp: string;
    };
}) {
    return (
        <div className="tech-event-card tech-event-card--blocked">
            <div className="tech-event-header">
                <div className="tech-event-header-left">
                    <span className="tech-badge tech-badge--error">
                        ▲ VIOLATION PREVENTED
                    </span>
                    <span className="tech-badge tech-badge--error-outline">
                        ACCESS DENIED
                    </span>
                    <span className="tech-badge tech-badge--failclosed">
                        0 BYTES RELEASED
                    </span>
                    <h4 className="tech-event-title tech-mono">{blocked.dataset}</h4>
                </div>
                <span className="tech-event-timestamp tech-mono">
                    {new Date(blocked.timestamp).toLocaleString()}
                </span>
            </div>

            <div className="tech-event-body">
                <div className="tech-event-meta-grid">
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">DATASET</span>
                        <span className="tech-meta-val tech-mono">{blocked.dataset}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">READER</span>
                        <span className="tech-meta-val tech-mono tech-highlight-reader">{blocked.reader}</span>
                    </div>
                    {blocked.organization && (
                        <div className="tech-event-meta-item">
                            <span className="tech-meta-lbl">ORGANIZATION</span>
                            <span className="tech-meta-val tech-mono">{blocked.organization}</span>
                        </div>
                    )}
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">ATTEMPTED OPERATION</span>
                        <span className="tech-meta-val tech-badge tech-badge--error">{blocked.requestedOperation}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">ACTION TAKEN</span>
                        <span className="tech-meta-val tech-text-error">{blocked.action}</span>
                    </div>
                    <div className="tech-event-meta-item">
                        <span className="tech-meta-lbl">DATA RELEASE</span>
                        <span className="tech-meta-val tech-text-error">0 BYTES SERVED</span>
                    </div>
                </div>

                <div className="tech-blocked-reason-box">
                    <span className="tech-blocked-reason-lbl">VIOLATION REASON:</span>
                    <span className="tech-blocked-reason-val">{blocked.reason}</span>
                </div>
            </div>
        </div>
    );
}

export function AuditView({ onNotify }: AuditViewProps) {
    const [trainingRunId, setTrainingRunId] = useState("sentiment.v1");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audit, setAudit] = useState<AuditResponse | null>(null);

    async function submit(): Promise<void> {
        setBusy(true);
        setError(null);
        setAudit(null);
        try {
            const response = await fetchAuditReport(trainingRunId);
            setAudit(response);
            onNotify(
                response.report.compliant
                    ? `Run ${response.report.trainingRunId} is compliant.`
                    : `Run ${response.report.trainingRunId} has ${response.report.problems.length} problem(s).`,
            );
        } catch (cause) {
            setError(
                cause instanceof LICENSEITApiError
                    ? cause.message
                    : "The audit could not be generated.",
            );
        } finally {
            setBusy(false);
        }
    }

    const report = audit?.report;
    const totalEvents = report
        ? (report.successfulReads ?? report.compliantReads ?? 0) + (report.blockedAttempts ?? report.blockedEvents?.length ?? 0)
        : 0;

    return (
        <div className="view-container">
            {/* Header */}
            <section className="tech-page-header">
                <div className="tech-header-meta">
                    <span className="tech-eyebrow">MODULE 04 // INDEPENDENT AUDIT &amp; ON-CHAIN PROVENANCE</span>
                    <span className="tech-badge tech-badge--neon">IMMUTABLE ON-CHAIN EVIDENCE</span>
                </div>
                <h1 className="tech-page-title">AUDIT &amp; COMPLIANCE</h1>
                <p className="tech-page-desc">
                    Immutable evidence of licensed dataset access. Replay on-chain receipts from Aptos and correlate with LicenNode active policy enforcement.
                </p>
            </section>

            {/* Query Form Card */}
            <div className="tech-card">
                <div className="tech-card-header">
                    <div className="tech-card-header-left">
                        <span className="tech-card-tag">[AUDIT TARGET]</span>
                        <h3 className="tech-card-title">Training Run Query</h3>
                    </div>
                    <span className="tech-card-sub">REPLAY RUN RECEIPTS FROM APTOS SMART CONTRACT</span>
                </div>

                <div className="tech-card-body">
                    <div className="tech-field">
                        <div className="tech-field-label-row">
                            <label htmlFor="trainingRunId" className="tech-label">Training Run ID</label>
                            <span className="tech-required-tag">REQUIRED</span>
                        </div>
                        <div className="tech-input-wrap">
                            <input
                                id="trainingRunId"
                                className="tech-input tech-mono"
                                value={trainingRunId}
                                required
                                maxLength={512}
                                placeholder="e.g. sentiment.v1"
                                onChange={(event) => setTrainingRunId(event.target.value)}
                            />
                        </div>
                        <span className="tech-help-text">Run identifier used during dataset training access</span>
                    </div>

                    <div className="tech-actions-bar">
                        <button
                            type="button"
                            className="tech-btn tech-btn--primary"
                            disabled={busy}
                            onClick={submit}
                        >
                            <span className="material-symbols-outlined tech-btn-icon" aria-hidden="true">
                                verified
                            </span>
                            Generate Comprehensive Audit Report
                        </button>
                    </div>
                </div>
            </div>

            {/* Error and Busy Feedbacks */}
            {error && <ErrorBanner title="Audit Retrieval Failed" message={error} />}
            {busy && <BusyIndicator label="Replaying on-chain receipts from Aptos testnet & evaluating compliance proofs..." />}

            {/* Audit Report Presentation */}
            {report && (
                <div className="tech-audit-report" style={{ marginTop: "2rem" }}>
                    {/* Visual Hierarchy 1: VERIFICATION VERDICT BANNER */}
                    <div
                        className={`tech-verdict-banner ${
                            report.compliant ? "tech-verdict-banner--compliant" : "tech-verdict-banner--violation"
                        }`}
                    >
                        <VerificationScanner active={true} />
                        <div className="tech-verdict-inner">
                            <div className="tech-verdict-left">
                                <div className="tech-verdict-tag-row">
                                    <span className="tech-verdict-tag">ATTESTATION VERDICT</span>
                                    <span className="tech-verdict-run tech-mono">RUN: {report.trainingRunId}</span>
                                </div>
                                <h2 className="tech-verdict-title">
                                    {report.compliant ? "COMPLIANT ACCESS VERIFIED" : "NON-COMPLIANT ACCESS DETECTED"}
                                </h2>
                                <p className="tech-verdict-sub">
                                    {report.compliant
                                        ? "ALL SERVED DATA ACCESS WAS AUTHORIZED UNDER MACHINE-READABLE LICENSE POLICY AND ANCHORED ON APTOS"
                                        : "UNLICENSED DATA ACCESS OR POLICY BREACH DETECTED DURING AUDIT REPLAY"}
                                </p>
                            </div>

                            <div className="tech-verdict-right">
                                <div className="tech-verdict-score-badge">
                                    <span className="tech-verdict-score-num">
                                        {report.compliantReads} / {report.totalReads}
                                    </span>
                                    <span className="tech-verdict-score-lbl">
                                        LICENSED READS
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Visual Trust Score Segmented Meter */}
                        <div className="tech-verdict-meter-box">
                            <TrustScoreMeter
                                total={report.totalReads}
                                licensed={report.compliantReads}
                                compliant={report.compliant}
                            />
                        </div>
                    </div>

                    {/* Visual Hierarchy 2: 5 REQUIRED COMPLIANCE METRICS */}
                    <div className="tech-stats-grid" style={{ marginBottom: "1.5rem" }}>
                        {/* 1. Training Run */}
                        <div className="tech-stat-tile">
                            <span className="tech-stat-label">TRAINING RUN</span>
                            <span className="tech-stat-val tech-mono" style={{ fontSize: "1.2rem", wordBreak: "break-all" }}>
                                {report.trainingRunId}
                            </span>
                            <span className="tech-stat-sub">TARGET AUDIT RUN</span>
                        </div>

                        {/* 2. Compliance Status */}
                        <div className={`tech-stat-tile ${report.compliant ? "tech-stat-tile--success" : "tech-stat-tile--danger"}`}>
                            <span className="tech-stat-label">COMPLIANCE STATUS</span>
                            <span className={`tech-stat-val tech-mono ${report.compliant ? "tech-stat-val--green" : "tech-stat-val--red"}`}>
                                {report.compliant ? "COMPLIANT" : "NON-COMPLIANT"}
                            </span>
                            <span className="tech-stat-sub">ATTESTATION RESULT</span>
                        </div>

                        {/* 3. Successful Reads */}
                        <div className="tech-stat-tile tech-stat-tile--success">
                            <span className="tech-stat-label">SUCCESSFUL READS</span>
                            <span className="tech-stat-val tech-stat-val--green tech-mono">
                                {report.successfulReads ?? report.compliantReads}
                            </span>
                            <span className="tech-stat-sub">APTOS ANCHORED</span>
                        </div>

                        {/* 4. Blocked Violations */}
                        <div className={`tech-stat-tile ${report.blockedAttempts > 0 ? "tech-stat-tile--danger" : ""}`}>
                            <span className="tech-stat-label">BLOCKED VIOLATIONS</span>
                            <span className={`tech-stat-val tech-mono ${report.blockedAttempts > 0 ? "tech-stat-val--red" : ""}`}>
                                {report.blockedAttempts ?? 0}
                            </span>
                            <span className="tech-stat-sub">PREVENTED BREACHES</span>
                        </div>

                        {/* 5. Total Access Events */}
                        <div className="tech-stat-tile">
                            <span className="tech-stat-label">TOTAL ACCESS EVENTS</span>
                            <span className="tech-stat-val tech-mono">
                                {totalEvents}
                            </span>
                            <span className="tech-stat-sub">ATTEMPTED &amp; SERVED</span>
                        </div>
                    </div>

                    {/* Detailed Metadata Summary Card */}
                    <div className="tech-card" style={{ marginBottom: "1.5rem" }}>
                        <div className="tech-card-header">
                            <div className="tech-card-header-left">
                                <span className="tech-card-tag">[METADATA LEDGER]</span>
                                <h3 className="tech-card-title">Run Compliance Summary</h3>
                            </div>
                            <span className="tech-card-sub">
                                GENERATED: {report.generatedAt}
                            </span>
                        </div>

                        <div className="tech-card-body">
                            <DetailList
                                rows={[
                                    { label: "Training run ID", value: report.trainingRunId },
                                    { label: "Generated at timestamp", value: report.generatedAt },
                                    { label: "Successful compliant reads", value: `${report.successfulReads ?? report.compliantReads}` },
                                    { label: "Blocked violation attempts", value: `${report.blockedAttempts ?? 0}` },
                                    { label: "Total access events", value: `${totalEvents}` },
                                    { label: "Distinct datasets accessed", value: `${report.distinctBlobs}` },
                                ]}
                            />
                        </div>
                    </div>

                    {/* Visual Hierarchy 3: EVENT TIMELINE / TABLE */}
                    <div className="tech-timeline-section">
                        <div className="tech-section-header">
                            <div className="tech-section-left">
                                <span className="tech-card-tag">[EVIDENCE TIMELINE]</span>
                                <h3 className="tech-section-title">Access Events &amp; On-Chain Ledger</h3>
                            </div>
                            <span className="tech-section-badge">
                                {report.reads.length + (report.blockedEvents?.length ?? 0)} TOTAL RECORDS
                            </span>
                        </div>

                        {/* Blocked Violations (if any) */}
                        {report.blockedEvents && report.blockedEvents.length > 0 && (
                            <div className="tech-events-group" style={{ marginBottom: "1.5rem" }}>
                                <div className="tech-group-title tech-group-title--blocked">
                                    ▲ BLOCKED VIOLATION EVENTS ({report.blockedEvents.length})
                                </div>
                                <div className="tech-events-list">
                                    {report.blockedEvents.map((b, idx) => (
                                        <BlockedEventCard key={idx} blocked={b} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Compliant Reads (Anchored on Aptos) */}
                        <div className="tech-events-group">
                            <div className="tech-group-title tech-group-title--compliant">
                                ✓ COMPLIANT READ RECEIPTS ANCHORED ON APTOS ({report.reads.length})
                            </div>
                            {report.reads.length === 0 ? (
                                <div className="tech-empty-state">
                                    <span className="material-symbols-outlined tech-empty-icon" aria-hidden="true">
                                        inventory_2
                                    </span>
                                    <p className="tech-empty-text">
                                        No successful reads were logged on chain for this run.
                                    </p>
                                </div>
                            ) : (
                                <div className="tech-events-list">
                                    {report.reads.map((read) => (
                                        <CompliantReadCard
                                            key={read.transactionHash}
                                            read={read}
                                            explorerUrl={audit?.explorerUrls[read.transactionHash]}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
