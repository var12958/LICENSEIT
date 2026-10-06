import { useEffect } from "react";
import { CopyButton } from "./CopyButton.js";

export interface ErrorBannerProps {
    title: string;
    message: string;
}

/**
 * Technical ErrorBanner: high-contrast security-console alert block with
 * sharp rectangular borders and alert icon.
 */
export function ErrorBanner({ title, message }: ErrorBannerProps) {
    return (
        <div className="tech-error-banner" role="alert">
            <div className="tech-error-icon" aria-hidden="true">
                !
            </div>
            <div className="tech-error-body">
                <span className="tech-error-tag">ALERT // OPERATION REJECTED</span>
                <p className="tech-error-title">{title}</p>
                <p className="tech-error-message">{message}</p>
            </div>
        </div>
    );
}

export interface BusyIndicatorProps {
    label: string;
}

/**
 * Technical BusyIndicator: high-tech animated processing bar with glowing neon pulse.
 */
export function BusyIndicator({ label }: BusyIndicatorProps) {
    return (
        <div className="tech-busy-banner" aria-live="polite">
            <div className="tech-busy-pulse" aria-hidden="true">
                <span className="tech-busy-dot" />
                <span className="tech-busy-ring" />
            </div>
            <div className="tech-busy-content">
                <span className="tech-busy-tag">EXECUTING ON-CHAIN / STORAGE PROTOCOL</span>
                <span className="tech-busy-label">{label}</span>
            </div>
            <div className="tech-busy-scanner-line" aria-hidden="true" />
        </div>
    );
}

export interface SnackbarProps {
    message: string;
    onDismiss: () => void;
}

const SNACKBAR_DURATION_MS = 6000;

/**
 * Technical Snackbar: Sharp HUD console toast with neon green status indicator and dismiss button.
 */
export function Snackbar({ message, onDismiss }: SnackbarProps) {
    useEffect(() => {
        const timer = window.setTimeout(onDismiss, SNACKBAR_DURATION_MS);
        return () => window.clearTimeout(timer);
    }, [message, onDismiss]);

    return (
        <div className="tech-snackbar" role="status">
            <div className="tech-snackbar-indicator" aria-hidden="true" />
            <div className="tech-snackbar-content">
                <span className="tech-snackbar-tag">SYSTEM EVENT LOGGED</span>
                <span className="tech-snackbar-text">{message}</span>
            </div>
            <button
                type="button"
                className="tech-snackbar-dismiss"
                onClick={onDismiss}
                aria-label="Dismiss notification"
            >
                Dismiss
            </button>
        </div>
    );
}

export interface DetailRow {
    label: string;
    value: string;
    /** Renders in a monospace face, for hashes and merkle roots. */
    mono?: boolean;
}

/**
 * Technical DetailList: High-contrast cryptographic key-value table.
 * Long hashes have automatic copy-to-clipboard buttons and clean monospace formatting.
 */
export function DetailList({ rows }: { rows: readonly DetailRow[] }) {
    return (
        <dl className="tech-detail-grid">
            {rows.map((row) => {
                const isHashOrTx =
                    row.mono &&
                    row.value.length > 10 &&
                    !row.value.includes(" ") &&
                    (row.label.toLowerCase().includes("root") ||
                        row.label.toLowerCase().includes("hash") ||
                        row.label.toLowerCase().includes("sha") ||
                        row.label.toLowerCase().includes("account") ||
                        row.label.toLowerCase().includes("transaction") ||
                        row.label.toLowerCase().includes("license id"));

                return (
                    <div key={row.label} className="tech-detail-row">
                        <dt className="tech-detail-label">
                            <span className="tech-detail-prefix">//</span> {row.label}
                        </dt>
                        <dd className={`tech-detail-value ${row.mono ? "tech-mono" : ""}`}>
                            <span className="tech-value-text">{row.value}</span>
                            {isHashOrTx && <CopyButton text={row.value} />}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}
