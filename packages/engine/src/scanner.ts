import type { Phrase, ScanResult, ScannerState, Setup } from "@atc/types";
import { byOpportunity } from "./setups";
import type { AnalysisResult } from "./setups";
import { directionPhrase, p, scannerPhrase, statusPhrase } from "./phrases";

export function toScanResult(result: AnalysisResult): ScanResult {
  return {
    symbol: result.symbol,
    setups: result.setups,
    best: result.best,
    dataStatus: result.dataStatus,
  };
}

export interface Opportunity {
  setup: Setup;
  rank: number;
}

/**
 * Top Opportunities ordering: readiness -> Setup Quality -> R:R -> HTF agreement.
 * AI confidence is shown but never used to sort (§32).
 */
export function rankOpportunities(results: AnalysisResult[], limit = 10): Opportunity[] {
  const setups: Setup[] = [];
  for (const r of results) {
    for (const s of r.setups) {
      // A NO_TRADE setup is excluded whatever its direction. The old
      // `&& direction === "none"` let blocked directional setups — the ones
      // `resolveScannerState` deliberately demoted — back into the list.
      if (s.scannerState === "NO_TRADE") continue;
      setups.push(s);
    }
  }
  return setups
    .sort(byOpportunity)
    .slice(0, limit)
    .map((setup, i) => ({ setup, rank: i + 1 }));
}

export interface ScannerBuckets {
  ENTRY_NOW: Setup[];
  WAIT_CONFIRMATION: Setup[];
  LIMIT_ZONE: Setup[];
  WATCHLIST: Setup[];
  NO_TRADE: Setup[];
}

export function bucketByState(results: AnalysisResult[]): ScannerBuckets {
  const buckets: ScannerBuckets = {
    ENTRY_NOW: [],
    WAIT_CONFIRMATION: [],
    LIMIT_ZONE: [],
    WATCHLIST: [],
    NO_TRADE: [],
  };
  for (const r of results) {
    for (const s of r.setups) buckets[s.scannerState].push(s);
  }
  for (const key of Object.keys(buckets) as ScannerState[]) {
    buckets[key].sort(byOpportunity);
  }
  return buckets;
}

export interface MeaningfulChange {
  setupId: string;
  symbol: string;
  kind: "state_change" | "status_change" | "invalidated" | "quality_jump";
  message: Phrase;
}

/**
 * §20: alert only when something actually changed. A score drifting by a point
 * is not an alert.
 */
export function diffForAlerts(previous: Setup[], next: Setup[]): MeaningfulChange[] {
  const byId = new Map(previous.map((s) => [s.id, s]));
  const changes: MeaningfulChange[] = [];

  for (const s of next) {
    const old = byId.get(s.id);
    if (!old) {
      if (s.scannerState === "ENTRY_NOW" || s.scannerState === "WAIT_CONFIRMATION") {
        changes.push({
          setupId: s.id,
          symbol: s.symbol,
          kind: "state_change",
          message: p("alert.newSetup", {
            direction: directionPhrase(s.direction),
            symbol: s.symbol,
            tf: s.timeframe,
            state: scannerPhrase(s.scannerState),
          }),
        });
      }
      continue;
    }
    if (old.status !== s.status && s.status === "INVALIDATED") {
      changes.push({
        setupId: s.id,
        symbol: s.symbol,
        kind: "invalidated",
        message: p("alert.invalidated", {
          symbol: s.symbol,
          direction: directionPhrase(s.direction),
          reason: s.invalidation[0] ?? p("alert.invalidatedZoneBroken"),
        }),
      });
      continue;
    }
    if (old.scannerState !== s.scannerState) {
      changes.push({
        setupId: s.id,
        symbol: s.symbol,
        kind: "state_change",
        message: p("alert.stateChange", {
          symbol: s.symbol,
          from: scannerPhrase(old.scannerState),
          to: scannerPhrase(s.scannerState),
        }),
      });
      continue;
    }
    if (old.status !== s.status) {
      changes.push({
        setupId: s.id,
        symbol: s.symbol,
        kind: "status_change",
        message: p("alert.statusChange", {
          symbol: s.symbol,
          from: statusPhrase(old.status),
          to: statusPhrase(s.status),
        }),
      });
      continue;
    }
    if (Math.abs(old.quality.score - s.quality.score) >= 15) {
      changes.push({
        setupId: s.id,
        symbol: s.symbol,
        kind: "quality_jump",
        message: p("alert.qualityJump", {
          symbol: s.symbol,
          from: old.quality.score,
          to: s.quality.score,
        }),
      });
    }
  }

  return changes;
}
