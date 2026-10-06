import { useEffect, useState, type ReactNode } from "react";
import { BackgroundGrid } from "./TechVisuals.js";

export type ViewId = "dashboard" | "upload" | "read" | "audit";

export interface ShellDestination {
    id: ViewId;
    label: string;
    sublabel: string;
    icon: string;
    code: string;
}

export const SHELL_DESTINATIONS: readonly ShellDestination[] = [
    { id: "dashboard", label: "DASHBOARD", sublabel: "Telemetry & Status", icon: "dashboard", code: "01" },
    { id: "upload", label: "DATA INGEST", sublabel: "Asset Registration", icon: "cloud_upload", code: "02" },
    { id: "read", label: "CONTROLLED ACCESS", sublabel: "Policy Enforcement Gate", icon: "shield_lock", code: "03" },
    { id: "audit", label: "AUDIT", sublabel: "On-Chain Evidence", icon: "verified", code: "04" },
];

export interface ShellProps {
    activeView: ViewId;
    onNavigate: (view: ViewId) => void;
    children: ReactNode;
}

export function Shell({ activeView, onNavigate, children }: ShellProps) {
    const [scrolled, setScrolled] = useState(false);
    const [theme, setTheme] = useState<"light" | "dark">(() => {
        try {
            return (localStorage.getItem("licenseit-theme") as "light" | "dark") || "light";
        } catch {
            return "light";
        }
    });

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem("licenseit-theme", theme);
        } catch {
            // localstorage unavailable
        }
    }, [theme]);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 0);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const toggleTheme = () => {
        setTheme((curr) => (curr === "light" ? "dark" : "light"));
    };

    return (
        <BackgroundGrid>
            {/* Top Command Console Bar */}
            <header className={`tech-topbar ${scrolled ? "tech-topbar--scrolled" : ""}`}>
                <div className="tech-topbar-brand">
                    <div className="tech-brand-badge" aria-hidden="true">
                        <span className="tech-brand-dot" />
                        <span className="material-symbols-outlined tech-brand-icon">shield_lock</span>
                    </div>
                    <div className="tech-brand-text">
                        <div className="tech-brand-title">
                            <span className="tech-brand-name">LICENSEIT</span>
                            <span className="tech-brand-tag">INFRASTRUCTURE CONSOLE</span>
                        </div>
                        <span className="tech-brand-sub">LICENSED AI DATA GOVERNANCE // ON-CHAIN PROVENANCE</span>
                    </div>
                </div>

                {/* Central Command Navigation */}
                <nav className="tech-nav" role="tablist" aria-label="LICENSEIT sections">
                    {SHELL_DESTINATIONS.map((dest) => {
                        const selected = dest.id === activeView;
                        return (
                            <button
                                key={dest.id}
                                type="button"
                                role="tab"
                                id={`tab-${dest.id}`}
                                aria-selected={selected}
                                aria-controls={`panel-${dest.id}`}
                                className={`tech-nav-item ${selected ? "tech-nav-item--active" : ""}`}
                                onClick={() => onNavigate(dest.id)}
                            >
                                <span className="tech-nav-code">{dest.code}</span>
                                <div className="tech-nav-meta">
                                    <span className="tech-nav-label">{dest.label}</span>
                                </div>
                                {selected && <span className="tech-nav-active-pill" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </nav>

                {/* System Status Indicators & Theme Switcher */}
                <div className="tech-topbar-status">
                    <div className="tech-status-chip">
                        <span className="tech-status-dot tech-status-dot--live" />
                        <span className="tech-status-name">SHELBY</span>
                        <span className="tech-status-val">VAULT LIVE</span>
                    </div>
                    <div className="tech-status-chip">
                        <span className="tech-status-dot tech-status-dot--live" />
                        <span className="tech-status-name">APTOS</span>
                        <span className="tech-status-val">SYNCED</span>
                    </div>
                    <button
                        type="button"
                        className="tech-theme-toggle"
                        onClick={toggleTheme}
                        title={`Switch to ${theme === "light" ? "Dark" : "Off-White"} Mode`}
                        aria-label={`Switch to ${theme === "light" ? "Dark" : "Off-White"} Mode`}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>
                            {theme === "light" ? "dark_mode" : "light_mode"}
                        </span>
                        <span>{theme === "light" ? "DARK" : "OFF-WHITE"}</span>
                    </button>
                </div>
            </header>

            {/* Main Application Container */}
            <div className="tech-shell-body">
                <main
                    className="tech-main-pane"
                    role="tabpanel"
                    id={`panel-${activeView}`}
                    aria-labelledby={`tab-${activeView}`}
                >
                    {children}
                </main>
            </div>

            {/* Technical Security Footer */}
            <footer className="tech-footer">
                <div className="tech-footer-inner">
                    <div className="tech-footer-section">
                        <span className="tech-footer-heading">INFRASTRUCTURE ARCHITECTURE</span>
                        <span className="tech-footer-desc">
                            Distributed Shelby Decentralized Storage Vault + Aptos Move <code>receipt_log</code> Smart Contract
                        </span>
                    </div>
                    <div className="tech-footer-section">
                        <span className="tech-footer-heading">ZERO-TRUST VERIFICATION</span>
                        <span className="tech-footer-desc">
                            Pre-flight SHA-256 Merkle Verification • Machine-Readable Policy Enforcement • Immutable Receipts
                        </span>
                    </div>
                    <div className="tech-footer-section tech-footer-right">
                        <span className="tech-footer-badge">
                            <span className="tech-badge-dot" />
                            NETWORK LIVE
                        </span>
                        <span className="tech-footer-copy">LICENSEIT Data Security Console v0.1.0-PROD</span>
                    </div>
                </div>
            </footer>
        </BackgroundGrid>
    );
}
