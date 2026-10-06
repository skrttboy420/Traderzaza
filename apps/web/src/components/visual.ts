import type { DataQuality, Direction, ScannerState, SetupStatus, ZoneFreshness } from "@atc/types";

/**
 * §79: colour is never the only signal. Every entry here pairs a colour with a
 * glyph, and the components that use it always render the translated label too.
 */
export interface StateVisual {
  glyph: string;
  text: string;
  bg: string;
  border: string;
  dot: string;
}

export const SCANNER_VISUAL: Record<ScannerState, StateVisual> = {
  ENTRY_NOW: {
    glyph: "●",
    text: "text-[var(--color-long)]",
    bg: "bg-[var(--color-long-soft)]",
    border: "border-[var(--color-long)]/50",
    dot: "bg-[var(--color-long)]",
  },
  WAIT_CONFIRMATION: {
    glyph: "◐",
    text: "text-[var(--color-wait)]",
    bg: "bg-[var(--color-wait-soft)]",
    border: "border-[var(--color-wait)]/50",
    dot: "bg-[var(--color-wait)]",
  },
  LIMIT_ZONE: {
    glyph: "◆",
    text: "text-[var(--color-limit)]",
    bg: "bg-[var(--color-limit-soft)]",
    border: "border-[var(--color-limit)]/50",
    dot: "bg-[var(--color-limit)]",
  },
  WATCHLIST: {
    glyph: "○",
    text: "text-[var(--color-muted)]",
    bg: "bg-[var(--color-neutral-soft)]",
    border: "border-[var(--color-border)]",
    dot: "bg-[var(--color-neutral)]",
  },
  NO_TRADE: {
    glyph: "✕",
    text: "text-[var(--color-short)]",
    bg: "bg-[var(--color-short-soft)]",
    border: "border-[var(--color-short)]/40",
    dot: "bg-[var(--color-short)]",
  },
};

export const SCANNER_ORDER: ScannerState[] = [
  "ENTRY_NOW",
  "WAIT_CONFIRMATION",
  "LIMIT_ZONE",
  "WATCHLIST",
  "NO_TRADE",
];

export function directionVisual(direction: Direction): StateVisual {
  if (direction === "long") {
    return {
      glyph: "▲",
      text: "text-[var(--color-long)]",
      bg: "bg-[var(--color-long-soft)]",
      border: "border-[var(--color-long)]/50",
      dot: "bg-[var(--color-long)]",
    };
  }
  if (direction === "short") {
    return {
      glyph: "▼",
      text: "text-[var(--color-short)]",
      bg: "bg-[var(--color-short-soft)]",
      border: "border-[var(--color-short)]/50",
      dot: "bg-[var(--color-short)]",
    };
  }
  return {
    glyph: "—",
    text: "text-[var(--color-muted)]",
    bg: "bg-[var(--color-neutral-soft)]",
    border: "border-[var(--color-border)]",
    dot: "bg-[var(--color-neutral)]",
  };
}

export const QUALITY_VISUAL: Record<"A" | "B" | "C" | "D", StateVisual> = {
  A: {
    glyph: "A",
    text: "text-[var(--color-long)]",
    bg: "bg-[var(--color-long-soft)]",
    border: "border-[var(--color-long)]/50",
    dot: "bg-[var(--color-long)]",
  },
  B: {
    glyph: "B",
    text: "text-[var(--color-long-dim)]",
    bg: "bg-[var(--color-long-soft)]",
    border: "border-[var(--color-long)]/30",
    dot: "bg-[var(--color-long-dim)]",
  },
  C: {
    glyph: "C",
    text: "text-[var(--color-wait)]",
    bg: "bg-[var(--color-wait-soft)]",
    border: "border-[var(--color-wait)]/40",
    dot: "bg-[var(--color-wait)]",
  },
  D: {
    glyph: "D",
    text: "text-[var(--color-muted)]",
    bg: "bg-[var(--color-neutral-soft)]",
    border: "border-[var(--color-border)]",
    dot: "bg-[var(--color-neutral)]",
  },
};

export const DATA_VISUAL: Record<DataQuality, StateVisual> = {
  LIVE: {
    glyph: "◉",
    text: "text-[var(--color-long)]",
    bg: "bg-[var(--color-long-soft)]",
    border: "border-[var(--color-long)]/40",
    dot: "bg-[var(--color-long)]",
  },
  DELAYED: {
    glyph: "◷",
    text: "text-[var(--color-wait)]",
    bg: "bg-[var(--color-wait-soft)]",
    border: "border-[var(--color-wait)]/40",
    dot: "bg-[var(--color-wait)]",
  },
  DEMO: {
    glyph: "⚠",
    text: "text-[var(--color-wait)]",
    bg: "bg-[var(--color-wait-soft)]",
    border: "border-[var(--color-wait)]/50",
    dot: "bg-[var(--color-wait)]",
  },
};

/** Lifecycle progress 0-1, used for the status rail on the setup detail page. */
export const STATUS_ORDER: SetupStatus[] = [
  "WATCHING",
  "ZONE_APPROACHING",
  "IN_ZONE",
  "WAITING_CONFIRMATION",
  "ENTRY_VALID",
  "ACTIVE",
  "MANAGING",
  "COMPLETED",
];

export function statusIsDead(status: SetupStatus): boolean {
  return status === "INVALIDATED" || status === "COMPLETED";
}

export const FRESHNESS_VISUAL: Record<ZoneFreshness, { glyph: string; text: string }> = {
  fresh: { glyph: "★", text: "text-[var(--color-long)]" },
  tested_once: { glyph: "◆", text: "text-[var(--color-long-dim)]" },
  tested_twice: { glyph: "◇", text: "text-[var(--color-wait)]" },
  tested_multiple: { glyph: "○", text: "text-[var(--color-muted)]" },
  weak: { glyph: "·", text: "text-[var(--color-faint)]" },
  invalid: { glyph: "✕", text: "text-[var(--color-short)]" },
};

/**
 * Chart colours, kept here so the canvas and the DOM never drift apart.
 *
 * These are the dark-theme values and they are also the fallback: a canvas
 * cannot inherit a CSS variable, so `readChartColors` resolves the real ones
 * off the document. If that lookup ever fails — SSR, a detached node, a
 * browser mid-stylesheet — we would rather draw a readable dark chart than
 * an empty one, so every field below is a usable colour on its own.
 */
export const CHART_COLORS = {
  background: "#0a0d12",
  grid: "#1a2130",
  text: "#64748b",
  up: "#26a371",
  down: "#e5484d",
  demand: "rgba(38, 163, 113, 0.14)",
  demandLine: "rgba(38, 163, 113, 0.55)",
  supply: "rgba(229, 72, 77, 0.14)",
  supplyLine: "rgba(229, 72, 77, 0.55)",
  entry: "#3b82f6",
  stop: "#e5484d",
  target: "#26a371",
  invalid: "#4c5a71",
  swing: "#94a3b8",
} as const;

export type ChartColors = { -readonly [K in keyof typeof CHART_COLORS]: string };

/** Which CSS custom property backs each chart colour. */
const CHART_VARS: Record<keyof ChartColors, string> = {
  background: "--chart-bg",
  grid: "--chart-grid",
  text: "--chart-text",
  up: "--chart-up",
  down: "--chart-down",
  demand: "--chart-demand",
  demandLine: "--chart-demand-line",
  supply: "--chart-supply",
  supplyLine: "--chart-supply-line",
  entry: "--chart-entry",
  stop: "--chart-stop",
  target: "--chart-target",
  invalid: "--chart-invalid",
  swing: "--chart-swing",
};

/**
 * Resolve the chart palette for whichever theme is currently applied.
 *
 * Read from the chart's own element rather than from `:root`, so a chart
 * rendered inside a locally themed subtree gets that subtree's colours
 * instead of the page's. Call it again whenever the theme changes — the
 * values are resolved at call time and do not update themselves.
 */
export function readChartColors(el: Element | null): ChartColors {
  const resolved: ChartColors = { ...CHART_COLORS };
  if (typeof window === "undefined" || !el) return resolved;

  const style = window.getComputedStyle(el);
  for (const [field, cssVar] of Object.entries(CHART_VARS) as [keyof ChartColors, string][]) {
    const value = style.getPropertyValue(cssVar).trim();
    if (value) resolved[field] = value;
  }
  return resolved;
}
