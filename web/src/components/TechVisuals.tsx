import type { ReactNode } from "react";

/**
 * BackgroundGrid: Technical background grid with subtle grid lines, corner crosshairs,
 * and edge coordinate tags to create an authentic security console feel.
 */
export function BackgroundGrid({ children }: { children: ReactNode }) {
    return (
        <div className="tech-grid-wrapper">
            <div className="tech-grid-bg" aria-hidden="true" />
            <div className="tech-grid-crosshair tech-grid-crosshair--tl" aria-hidden="true">+</div>
            <div className="tech-grid-crosshair tech-grid-crosshair--tr" aria-hidden="true">+</div>
            <div className="tech-grid-crosshair tech-grid-crosshair--bl" aria-hidden="true">+</div>
            <div className="tech-grid-crosshair tech-grid-crosshair--br" aria-hidden="true">+</div>
            {children}
        </div>
    );
}

/**
 * VerificationScanner: A technical visual scanner bar that passes across the card
 * when results are loaded or rendered.
 */
export function VerificationScanner({ active = false }: { active?: boolean }) {
    if (!active) return null;
    return (
        <div className="tech-scanner-bar" aria-hidden="true">
            <div className="tech-scanner-beam" />
        </div>
    );
}

/**
 * TrustScoreMeter: Monospace visual compliance meter for AuditView.
 * Renders a segmented technical bar e.g. [██████████] 100%
 */
export interface TrustScoreMeterProps {
    total: number;
    licensed: number;
    compliant: boolean;
}

export function TrustScoreMeter({ total, licensed, compliant }: TrustScoreMeterProps) {
    const percentage = total > 0 ? Math.round((licensed / total) * 100) : 0;
    const totalSegments = 20;
    const filledSegments = total > 0 ? Math.round((licensed / total) * totalSegments) : 0;

    return (
        <div className={`trust-score-meter ${compliant ? "trust-score-meter--compliant" : "trust-score-meter--violation"}`}>
            <div className="trust-score-header">
                <span className="trust-score-title">
                    <span className="trust-score-dot" />
                    COMPLIANCE ATTESTATION SCORE
                </span>
                <span className="trust-score-val">{percentage}% ATTESTED</span>
            </div>
            <div className="trust-score-bar-wrap" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                <div className="trust-score-segments" aria-hidden="true">
                    {Array.from({ length: totalSegments }).map((_, i) => (
                        <span
                            key={i}
                            className={`trust-score-segment ${i < filledSegments ? "trust-score-segment--filled" : ""}`}
                        />
                    ))}
                </div>
            </div>
            <div className="trust-score-footer">
                <span>ON-CHAIN ATTESTATION: {licensed} / {total} VALIDATED READS</span>
                <span>VERDICT: {compliant ? "PASS // FULL INTEGRITY" : "FAIL // UNLICENSED ACCESS"}</span>
            </div>
        </div>
    );
}

/**
 * VerificationPipeline: Visual representation of the 5-step read verification sequence:
 * 01 LICENSE VERIFIED
 * 02 OPERATION AUTHORIZED
 * 03 MERKLE VERIFIED
 * 04 APTOS ANCHORED
 * 05 DATASET SERVED
 */
export interface VerificationPipelineProps {
    step: "idle" | "busy" | "success" | "denied";
    failedStageIndex?: number; // 0: License, 1: Operation, 2: Merkle, 3: Aptos, 4: Data
}

export function VerificationPipeline({ step, failedStageIndex = 0 }: VerificationPipelineProps) {
    const stages = [
        { id: 1, code: "01", name: "LICENSE VERIFIED", desc: "Policy, Expiry & RBAC Check" },
        { id: 2, code: "02", name: "OPERATION AUTHORIZED", desc: "Training vs Inference Rights" },
        { id: 3, code: "03", name: "MERKLE VERIFIED", desc: "SHA-256 Cryptographic Root" },
        { id: 4, code: "04", name: "APTOS ANCHORED", desc: "Receipt Log Settlement" },
        { id: 5, code: "05", name: "DATASET SERVED", desc: "Zero-Trust Stream Release" },
    ];

    return (
        <div className={`tech-pipeline tech-pipeline--${step}`}>
            <div className="tech-pipeline-header">
                <div className="tech-pipeline-header-left">
                    <span className="tech-pipeline-badge">[ENFORCEMENT PIPELINE]</span>
                    <span className="tech-pipeline-title">ZERO-TRUST ACCESS VERIFICATION SEQUENCE</span>
                </div>
                <span className="tech-pipeline-status">
                    {step === "busy" && "● EXECUTING POLICY EVALUATION..."}
                    {step === "success" && "● ALL 5 STAGES VERIFIED & ANCHORED"}
                    {step === "denied" && `▲ REFUSED AT STAGE ${stages[failedStageIndex]?.code ?? "01"}`}
                    {step === "idle" && "READY FOR CONTROLLED REQUEST"}
                </span>
            </div>
            <div className="tech-pipeline-stages">
                {stages.map((stage, idx) => {
                    let stageState: "idle" | "active" | "done" | "failed" = "idle";
                    if (step === "busy") {
                        stageState = "active";
                    } else if (step === "success") {
                        stageState = "done";
                    } else if (step === "denied") {
                        if (idx < failedStageIndex) {
                            stageState = "done";
                        } else if (idx === failedStageIndex) {
                            stageState = "failed";
                        } else {
                            stageState = "idle";
                        }
                    }

                    return (
                        <div key={stage.id} className={`tech-stage tech-stage--${stageState}`}>
                            <div className="tech-stage-top">
                                <span className="tech-stage-num">{stage.code}</span>
                                <span className="tech-stage-indicator">
                                    {stageState === "done" && "✓"}
                                    {stageState === "active" && "..."}
                                    {stageState === "failed" && "✕"}
                                    {stageState === "idle" && "○"}
                                </span>
                            </div>
                            <div className="tech-stage-content">
                                <span className="tech-stage-name">{stage.name}</span>
                                <span className="tech-stage-desc">{stage.desc}</span>
                            </div>
                            {idx < stages.length - 1 && (
                                <div className="tech-stage-connector" aria-hidden="true">→</div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
