import type { DataStatus, ScanResult, Setup } from "@atc/types";

/**
 * Shape handed from the server page to the client dashboard. Kept in a
 * framework-free module (not in the `"use client"` view file) so the server
 * component can build it without pulling the client bundle in.
 */
export interface HomeData {
  opportunities: { setup: Setup; rank: number }[];
  counts: Record<string, number>;
  scans: { symbol: string; best: Setup | null; dataStatus: DataStatus }[];
  /** Worst data quality across the watchlist — the honest headline figure. */
  weakestStatus: DataStatus;
  scannedAt: number;
  failed: { symbol: string; reason: string }[];
}

const QUALITY_RANK = { LIVE: 0, DELAYED: 1, DEMO: 2 } as const;

export const NO_DATA_STATUS: DataStatus = {
  quality: "DEMO",
  provider: "none",
  lastCandleTime: 0,
  candleCount: 0,
  note: "No candles loaded.",
};

export function weakestStatus(statuses: DataStatus[]): DataStatus {
  let weakest: DataStatus | null = null;
  for (const status of statuses) {
    if (!weakest || QUALITY_RANK[status.quality] > QUALITY_RANK[weakest.quality]) weakest = status;
  }
  return weakest ?? NO_DATA_STATUS;
}

export function toHomeData(
  scans: ScanResult[],
  opportunities: { setup: Setup; rank: number }[],
  counts: Record<string, number>,
  scannedAt: number,
  failed: { symbol: string; reason: string }[],
): HomeData {
  return {
    opportunities,
    counts,
    scans: scans.map((s) => ({ symbol: s.symbol, best: s.best, dataStatus: s.dataStatus })),
    weakestStatus: weakestStatus(scans.map((s) => s.dataStatus)),
    scannedAt,
    failed,
  };
}
