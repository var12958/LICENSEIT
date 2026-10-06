import { useEffect, useState } from "react";
import {
    fetchDashboard,
    resetAccounts,
    updateAccountStatus,
    type DashboardResponse,
    LICENSEITApiError,
} from "../api/LICENSEITApi.js";
import { BusyIndicator, ErrorBanner } from "../components/Feedback.js";
import { VerificationScanner } from "../components/TechVisuals.js";
import type { AccountStatus } from "../../../src/access/types.js";

export interface DashboardViewProps {
    onNavigateToRead: (blobName?: string) => void;
    onNotify: (message: string) => void;
}

export function DashboardView({ onNavigateToRead, onNotify }: DashboardViewProps) {
    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<string | null>(null);

    async function refresh(): Promise<void> {
        try {
            setLoading(true);
            setError(null);
            const res = await fetchDashboard();
            setData(res);
        } catch (err) {
            setError(err instanceof LICENSEITApiError ? err.message : "Failed to load dashboard data");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        refresh();
        const timer = setInterval(() => {
            fetchDashboard().then(setData).catch(() => {});
        }, 5000);
        return () => clearInterval(timer);
    }, []);

    async function handleResetAccounts(): Promise<void> {
        try {
            setBusyAction("reset");
            await resetAccounts();
            onNotify("Accounts and violation counters reset successfully.");
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Reset failed");
        } finally {
            setBusyAction(null);
        }
    }

    async function handleToggleAccountLock(readerId: string, currentStatus: AccountStatus): Promise<void> {
        try {
            setBusyAction(`lock-${readerId}`);
            const nextStatus: AccountStatus = currentStatus === "LOCKED" ? "ACTIVE" : "LOCKED";
            await updateAccountStatus(readerId, nextStatus);
            onNotify(`Account '${readerId}' status updated to ${nextStatus}.`);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Status update failed");
        } finally {
            setBusyAction(null);
        }
    }

    const totalDatasets = data?.datasets.length ?? 0;
    const totalRequests = data?.recentEvents.length ?? 0;
    const successfulRequests = data?.recentEvents.filter((e) => e.status === "ALLOWED").length ?? 0;
    const blockedRequests = data?.recentEvents.filter((e) => e.status === "BLOCKED").length ?? 0;
    const totalViolations = data?.violations.length ?? 0;

    return (
        <div className="view-container">
            {/* Top Product Hero Section */}
            <section className="tech-page-header">
                <div className="tech-header-meta">
                    <span className="tech-eyebrow">MODULE 01 // DASHBOARD &amp; REAL-TIME TELEMETRY</span>
                    <span className="tech-badge tech-badge--neon">REAL-TIME ZERO-TRUST GATE</span>
                </div>
                <div className="tech-hero-headline">
                    <h1 className="tech-page-title">
                        LICENSEIT
                    </h1>
                    <span className="tech-hero-tag">Licensed AI Data Governance Infrastructure</span>
                </div>
                <p className="tech-page-desc">
                    Control how licensed datasets are accessed, verify their integrity, and maintain immutable compliance evidence.
                </p>
            </section>

            {error && <ErrorBanner title="Dashboard Notice" message={error} />}
            {loading && !data && <BusyIndicator label="Loading compliance &amp; access status..." />}

            {data && (
                <>
                    {/* Top KPI Metrics Grid */}
                    <div className="tech-stats-grid">
                        <div className="tech-stat-tile">
                            <span className="tech-stat-label">PROTECTED ASSETS</span>
                            <span className="tech-stat-val tech-mono">{totalDatasets}</span>
                            <span className="tech-stat-sub">SHELBY VAULT DATASETS</span>
                        </div>
                        <div className="tech-stat-tile tech-stat-tile--success">
                            <span className="tech-stat-label">SUCCESSFUL READS</span>
                            <span className="tech-stat-val tech-stat-val--green tech-mono">{successfulRequests}</span>
                            <span className="tech-stat-sub">APTOS ON-CHAIN ANCHORED</span>
                        </div>
                        <div className={`tech-stat-tile ${blockedRequests > 0 ? "tech-stat-tile--danger" : ""}`}>
                            <span className="tech-stat-label">BLOCKED REQUESTS</span>
                            <span className={`tech-stat-val tech-mono ${blockedRequests > 0 ? "tech-stat-val--red" : ""}`}>
                                {blockedRequests}
                            </span>
                            <span className="tech-stat-sub">FAIL-CLOSED PREVENTIONS</span>
                        </div>
                        <div className={`tech-stat-tile ${totalViolations > 0 ? "tech-stat-tile--danger" : ""}`}>
                            <span className="tech-stat-label">ACTIVE VIOLATIONS</span>
                            <span className={`tech-stat-val tech-mono ${totalViolations > 0 ? "tech-stat-val--red" : ""}`}>
                                {totalViolations}
                            </span>
                            <span className="tech-stat-sub">POLICY AUDIT BREACHES</span>
                        </div>
                    </div>

                    {/* Active Violation Alerts (If any) */}
                    {data.violations.length > 0 && (
                        <div className="tech-card tech-card--alert" style={{ marginBottom: "1.5rem" }}>
                            <div className="tech-card-header tech-card-header--alert">
                                <div className="tech-card-header-left">
                                    <span className="material-symbols-outlined" style={{ color: "var(--status-error)", fontSize: "20px" }}>
                                        warning
                                    </span>
                                    <h3 className="tech-card-title" style={{ color: "var(--status-error)" }}>
                                        VIOLATION ALERTS // ACTIVE COMPLIANCE BREACHES
                                    </h3>
                                </div>
                                <span className="tech-badge tech-badge--error">
                                    {data.violations.length} EVENT{data.violations.length > 1 ? "S" : ""} LOGGED
                                </span>
                            </div>
                            <div className="tech-card-body">
                                <div className="tech-violations-list">
                                    {data.violations.slice(0, 4).map((v) => (
                                        <div key={v.id} className="tech-violation-item">
                                            <div className="tech-violation-main">
                                                <div className="tech-violation-head">
                                                    <span className="tech-violation-title">
                                                        ⚠ {v.eventType.replace(/_/g, " ")}
                                                    </span>
                                                    <span className="tech-mono tech-violation-ds">
                                                        // Dataset: <strong>{v.dataset}</strong>
                                                    </span>
                                                </div>
                                                <div className="tech-violation-meta">
                                                    Reader: <span className="tech-mono tech-highlight-reader">{v.readerId}</span>
                                                    {v.organizationId && <> | Org: <span className="tech-mono">{v.organizationId}</span></>}
                                                    {v.requestedOperation && <> | Attempted: <strong className="tech-violation-op">{v.requestedOperation}</strong></>}
                                                    {v.allowedOperations && v.allowedOperations.length > 0 && <> (Allowed: {v.allowedOperations.join(", ")})</>}
                                                </div>
                                                <div className="tech-violation-reason">
                                                    Reason: {v.reason}
                                                </div>
                                            </div>
                                            <div className="tech-violation-side">
                                                <span className={`tech-badge ${v.action === "USER_LOCKED" ? "tech-badge--error" : "tech-badge--warning"}`}>
                                                    {v.action.replace(/_/g, " ")}
                                                </span>
                                                <span className="tech-mono tech-violation-time">
                                                    {new Date(v.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Section 1: DATASET ACCESS STATUS Table */}
                    <div className="tech-card" style={{ marginBottom: "1.5rem" }}>
                        <VerificationScanner active={true} />
                        <div className="tech-card-header">
                            <div className="tech-card-header-left">
                                <span className="tech-card-tag">[REGISTRY]</span>
                                <h3 className="tech-card-title">Dataset Access Status</h3>
                            </div>
                            <span className="tech-card-sub">MACHINE-READABLE POLICY ENFORCEMENT</span>
                        </div>

                        <div className="tech-card-body tech-card-body--flush">
                            <div className="tech-table-scroll">
                                <table className="tech-table">
                                    <thead>
                                        <tr>
                                            <th>DATASET</th>
                                            <th>LICENSE ID</th>
                                            <th>PERMITTED OPERATION</th>
                                            <th>VALIDITY</th>
                                            <th>STATUS</th>
                                            <th style={{ textAlign: "center" }}>SUCCESS</th>
                                            <th style={{ textAlign: "center" }}>BLOCKED</th>
                                            <th>LATEST EVENT</th>
                                            <th style={{ textAlign: "right" }}>ACCESS GATE</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.datasets.map((d) => (
                                            <tr key={d.blobName}>
                                                <td style={{ fontWeight: 600 }}>
                                                    <span className="tech-mono tech-ds-name">
                                                        {d.blobName}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="tech-mono" style={{ fontWeight: 600, color: "var(--text-main)" }}>
                                                        {d.licenseId}
                                                    </span>
                                                    <div className="tech-sub-detail">{d.rightsHolder}</div>
                                                </td>
                                                <td>
                                                    {d.permittedOperations.map((op) => (
                                                        <span
                                                            key={op}
                                                            className={`tech-badge ${op === "TRAINING" ? "tech-badge--cyan" : "tech-badge--purple"}`}
                                                            style={{ marginRight: "0.3rem" }}
                                                        >
                                                            {op}
                                                        </span>
                                                    ))}
                                                </td>
                                                <td className="tech-mono" style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                                                    {d.validUntil && d.validUntil !== "N/A"
                                                        ? new Date(d.validUntil).toLocaleDateString()
                                                        : "N/A"}
                                                </td>
                                                <td>
                                                    <span className={`tech-badge ${d.accessStatus === "ACTIVE" ? "tech-badge--success" : "tech-badge--error"}`}>
                                                        {d.accessStatus}
                                                    </span>
                                                </td>
                                                <td style={{ textAlign: "center", color: "var(--status-success)", fontWeight: 700 }} className="tech-mono">
                                                    {d.successfulRequests}
                                                </td>
                                                <td style={{ textAlign: "center", color: d.blockedRequests > 0 ? "var(--status-error)" : "var(--text-muted)", fontWeight: 700 }} className="tech-mono">
                                                    {d.blockedRequests}
                                                </td>
                                                <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                                                    {d.latestEvent}
                                                </td>
                                                <td style={{ textAlign: "right" }}>
                                                    <button
                                                        type="button"
                                                        className="tech-btn tech-btn--action"
                                                        onClick={() => onNavigateToRead(d.blobName)}
                                                    >
                                                        Access Gate →
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: USER & ORGANIZATION ACCESS CONTROL & RECENT ACCESS EVENTS */}
                    <div className="tech-grid-two-col">
                        {/* Column A: USER & ORGANIZATION STATUS */}
                        <div className="tech-card">
                            <div className="tech-card-header">
                                <div className="tech-card-header-left">
                                    <span className="tech-card-tag">[GOVERNANCE]</span>
                                    <h3 className="tech-card-title">Account Status &amp; Governance</h3>
                                </div>
                                <div className="tech-card-header-right">
                                    <button
                                        type="button"
                                        className="tech-btn tech-btn--secondary"
                                        disabled={busyAction !== null}
                                        onClick={handleResetAccounts}
                                    >
                                        Reset Counters
                                    </button>
                                </div>
                            </div>

                            <div className="tech-card-body">
                                <p className="tech-card-explainer">
                                    Violation policy enforcement automatically tracks breach counts.
                                    Users reach <strong>RESTRICTED</strong> after 2 violations and <strong>LOCKED</strong> after 3 violations.
                                </p>

                                <div className="tech-accounts-list">
                                    {data.accounts.length === 0 ? (
                                        <div className="tech-empty-notice">
                                            No active developer accounts registered. Controlled access requests automatically register reader accounts.
                                        </div>
                                    ) : (
                                        data.accounts.map((acc) => (
                                            <div
                                                key={acc.readerId}
                                                className={`tech-account-row ${
                                                    acc.status === "LOCKED"
                                                        ? "tech-account-row--locked"
                                                        : acc.status === "RESTRICTED"
                                                          ? "tech-account-row--restricted"
                                                          : ""
                                                }`}
                                            >
                                                <div className="tech-account-info">
                                                    <div className="tech-account-title-row">
                                                        <span className="tech-mono tech-account-name">
                                                            {acc.readerId}
                                                        </span>
                                                        <span
                                                            className={`tech-badge ${
                                                                acc.status === "LOCKED"
                                                                    ? "tech-badge--error"
                                                                    : acc.status === "RESTRICTED"
                                                                      ? "tech-badge--warning"
                                                                      : "tech-badge--success"
                                                            }`}
                                                        >
                                                            {acc.status}
                                                        </span>
                                                    </div>
                                                    <div className="tech-account-sub">
                                                        {acc.organizationId && <>Org: <strong>{acc.organizationId}</strong> | </>}
                                                        Violations: <strong className={acc.violationCount > 0 ? "tech-text-error" : ""}>{acc.violationCount}</strong>
                                                        {acc.lastViolation && <> (Last: {acc.lastViolation})</>}
                                                    </div>
                                                </div>

                                                <div className="tech-account-actions">
                                                    <button
                                                        type="button"
                                                        className={`tech-btn tech-btn--toggle ${
                                                            acc.status === "LOCKED" ? "tech-btn--unlock" : "tech-btn--lock"
                                                        }`}
                                                        disabled={busyAction !== null}
                                                        onClick={() => handleToggleAccountLock(acc.readerId, acc.status)}
                                                    >
                                                        {acc.status === "LOCKED" ? "Unlock User" : "Lock User"}
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Column B: RECENT ACCESS EVENTS */}
                        <div className="tech-card">
                            <div className="tech-card-header">
                                <div className="tech-card-header-left">
                                    <span className="tech-card-tag">[AUDIT STREAM]</span>
                                    <h3 className="tech-card-title">Recent Access Events</h3>
                                </div>
                                <span className="tech-card-sub">LIVE TELEMETRY FEED</span>
                            </div>

                            <div className="tech-card-body" style={{ maxHeight: "420px", overflowY: "auto" }}>
                                {data.recentEvents.length === 0 ? (
                                    <div className="tech-empty-notice">
                                        No access events recorded yet. Use the Controlled Access console or Python SDK to request a dataset.
                                    </div>
                                ) : (
                                    <div className="tech-events-feed">
                                        {data.recentEvents.map((evt) => {
                                            const isAllowed = evt.status === "ALLOWED";
                                            return (
                                                <div
                                                    key={evt.id}
                                                    className={`tech-event-item ${
                                                        isAllowed ? "tech-event-item--allowed" : "tech-event-item--blocked"
                                                    }`}
                                                >
                                                    <div className="tech-event-top">
                                                        <div className="tech-event-status-tag">
                                                            <span className={`tech-badge ${isAllowed ? "tech-badge--success" : "tech-badge--error"}`}>
                                                                {isAllowed ? "✓ ALLOWED" : "▲ BLOCKED"}
                                                            </span>
                                                            <span className="tech-event-op">
                                                                {evt.operation}
                                                            </span>
                                                            <span className="tech-mono tech-event-ds">
                                                                {evt.dataset}
                                                            </span>
                                                        </div>
                                                        <span className="tech-mono tech-event-time">
                                                            {new Date(evt.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    <div className="tech-event-detail">
                                                        Reader: <span className="tech-mono tech-highlight-reader">{evt.readerId}</span>
                                                        {evt.trainingRunId && <> | Run: <span className="tech-mono">{evt.trainingRunId}</span></>}
                                                    </div>
                                                    {evt.reason && (
                                                        <div className="tech-event-reason">
                                                            Reason: {evt.reason}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
