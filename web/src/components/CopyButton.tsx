import { useState } from "react";

export function CopyButton({ text, label = "COPY" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard unavailable
        }
    };

    return (
        <button
            type="button"
            className={`tech-copy-btn ${copied ? "tech-copy-btn--copied" : ""}`}
            onClick={handleCopy}
            title={copied ? "Copied to clipboard" : `Copy "${text}"`}
            aria-label="Copy to clipboard"
        >
            <span className="tech-copy-icon" aria-hidden="true">
                {copied ? "✓" : "⧉"}
            </span>
            <span className="tech-copy-text">{copied ? "COPIED" : label}</span>
        </button>
    );
}
