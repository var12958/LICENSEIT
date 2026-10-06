/**
 * Technical Design System Tokens for LICENSEIT
 * 
 * Signature Aesthetics:
 * - Off-White (#F4F3EE) primary background
 * - Secondary Background (#ECEBE5)
 * - Pure White (#FFFFFF) cards
 * - Deep Black (#111111) text and dark structural anchors
 * - Secondary Text (#666666)
 * - Crisp Thin Borders (#D7D6CF)
 * - Primary Neon Green Accent (#B7FF00) & Dark Accent (#7FAF00)
 * - Semantic Statuses:
 *     - Success: #65C466
 *     - Warning: #D99A00
 *     - Error:   #E5484D
 */

export const TECH_THEME_TOKENS = {
    // Primary Console Theme: Off-White + Black + Neon Green
    light: {
        "bg-base": "#F4F3EE",
        "bg-surface": "#FFFFFF",
        "bg-subtle": "#ECEBE5",
        "bg-elevated": "#E2E1DA",
        "bg-dark": "#111111",
        "bg-dark-card": "#181818",
        
        "text-main": "#111111",
        "text-muted": "#666666",
        "text-subtle": "#888888",
        "text-dark": "#111111",
        "text-inverse": "#FFFFFF",
        
        "border-main": "#D7D6CF",
        "border-subtle": "#E5E4DC",
        "border-dark": "#111111",
        "border-light": "rgba(17, 17, 17, 0.08)",
        
        "accent-neon": "#B7FF00",
        "accent-neon-dim": "rgba(183, 255, 0, 0.22)",
        "accent-neon-hover": "#A6E800",
        "accent-neon-dark": "#7FAF00",
        "accent-neon-glow": "0 0 12px rgba(183, 255, 0, 0.45)",
        
        "status-success": "#65C466",
        "status-success-bg": "rgba(101, 196, 102, 0.12)",
        "status-success-border": "rgba(101, 196, 102, 0.35)",
        "status-error": "#E5484D",
        "status-error-bg": "rgba(229, 72, 77, 0.10)",
        "status-error-border": "rgba(229, 72, 77, 0.35)",
        "status-warning": "#D99A00",
        "status-warning-bg": "rgba(217, 154, 0, 0.12)",
        "status-warning-border": "rgba(217, 154, 0, 0.35)",
        
        "grid-line": "rgba(17, 17, 17, 0.045)",
    },
    // Dark Console Theme (alternative mode)
    dark: {
        "bg-base": "#0E0F12",
        "bg-surface": "#14161A",
        "bg-subtle": "#1B1E24",
        "bg-elevated": "#232730",
        "bg-dark": "#08090B",
        "bg-dark-card": "#181B22",
        
        "text-main": "#F4F3EE",
        "text-muted": "#999999",
        "text-subtle": "#666666",
        "text-dark": "#FFFFFF",
        "text-inverse": "#111111",
        
        "border-main": "#2B2E36",
        "border-subtle": "#383D48",
        "border-dark": "#FFFFFF",
        "border-light": "rgba(244, 243, 238, 0.1)",
        
        "accent-neon": "#B7FF00",
        "accent-neon-dim": "rgba(183, 255, 0, 0.15)",
        "accent-neon-hover": "#C6FF33",
        "accent-neon-dark": "#7FAF00",
        "accent-neon-glow": "0 0 12px rgba(183, 255, 0, 0.35)",
        
        "status-success": "#65C466",
        "status-success-bg": "rgba(101, 196, 102, 0.14)",
        "status-success-border": "rgba(101, 196, 102, 0.35)",
        "status-error": "#E5484D",
        "status-error-bg": "rgba(229, 72, 77, 0.14)",
        "status-error-border": "rgba(229, 72, 77, 0.35)",
        "status-warning": "#D99A00",
        "status-warning-bg": "rgba(217, 154, 0, 0.14)",
        "status-warning-border": "rgba(217, 154, 0, 0.35)",
        
        "grid-line": "rgba(244, 243, 238, 0.035)",
    },
    
    // Typography Stacks
    "font-display": "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
    "font-body": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "font-mono": "'JetBrains Mono', 'SF Mono', Consolas, monospace",
} as const;

export function buildM3TokenCss(): string {
    const lightDeclarations: string[] = [];
    for (const [key, value] of Object.entries(TECH_THEME_TOKENS.light)) {
        lightDeclarations.push(`--${key}: ${value};`);
    }

    const darkDeclarations: string[] = [];
    for (const [key, value] of Object.entries(TECH_THEME_TOKENS.dark)) {
        darkDeclarations.push(`--${key}: ${value};`);
    }

    return `:root, [data-theme="light"] {\n  ${lightDeclarations.join("\n  ")}\n}\n[data-theme="dark"] {\n  ${darkDeclarations.join("\n  ")}\n}`;
}
