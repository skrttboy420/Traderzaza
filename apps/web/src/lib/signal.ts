import type { AnalysisResult } from "@atc/engine";
import type { DataStatus, Phrase, ScannerState, Setup } from "@atc/types";

import { weakestStatus } from "./home";

/**
 * The /signal screen: only the markets that are actually calling a trade.
 *
 * Kept framework-free (no `"use client"`, no React) so the server page can
 * build the payload without pulling the client bundle in — same split as
 * `lib/home.ts`.
 */

/**
 * The three scanner states that count as a signal.
 *
 * `WATCHLIST` and `NO_TRADE` are excluded by design. `WATCHLIST` is where
 * `resolveScannerState` demotes a setup that reached its zone but has a
 * blocking reason against it — a conflicted chain, a reversal read, a
 * compressed regime. Those are the setups most likely to tempt a trader, which
 * is exactly why they must not appear on a page titled "signals".
 */
export const SIGNAL_STATES = ["ENTRY_NOW", "WAIT_CONFIRMATION", "LIMIT_ZONE"] as const;

export type SignalState = (typeof SIGNAL_STATES)[number];

export function isSignal(setup: Setup): boolean {
  return (
    setup.status !== "INVALIDATED" &&
    (SIGNAL_STATES as readonly ScannerState[]).includes(setup.scannerState)
  );
}

export interface SignalTier {
  state: SignalState;
  setups: Setup[];
}

/**
 * A market that produced no signal, and the reason why.
 *
 * This exists because an empty signal page is the normal state of a
 * supply/demand system, not an error — on a conflicted session every market can
 * legitimately be blocked. Showing a bare "nothing here" would read as a broken
 * feed and push the user to go and find a trade elsewhere. Naming the blocker
 * per market is the same promise the rest of the app makes: the call comes with
 * its reasoning, and so does the refusal.
 */
export interface BlockedMarket {
  symbol: string;
  state: ScannerState;
  /** Engine phrases, rendered client-side so they follow the locale. */
  reasons: Phrase[];
  /** Null when the engine produced no setup at all for this market. */
  quality: number | null;
}

export interface SignalData {
  tiers: SignalTier[];
  total: number;
  blocked: BlockedMarket[];
  weakestStatus: DataStatus;
  scannedAt: number;
  failed: { symbol: string; reason: string }[];
}

/** How many blockers to carry per market. Enough to be useful, not a wall. */
const MAX_REASONS = 3;

export function toSignalData(
  results: AnalysisResult[],
  scannedAt: number,
  failed: { symbol: string; reason: string }[],
): SignalData {
  const tiers: SignalTier[] = SIGNAL_STATES.map((state) => ({ state, setups: [] }));
  const byState = new Map<SignalState, Setup[]>(tiers.map((tier) => [tier.state, tier.setups]));

  const blocked: BlockedMarket[] = [];

  for (const result of results) {
    const signals = result.setups.filter(isSignal);
    if (signals.length > 0) {
      for (const setup of signals) byState.get(setup.scannerState as SignalState)?.push(setup);
      continue;
    }

    // No signal from this market. Prefer the setup's own `whyWait` over the
    // symbol-level `noTradeReasons`: it is specific to the idea that nearly
    // qualified, which is more useful than the generic market-wide refusal.
    const best = result.best;
    const reasons = best && best.whyWait.length > 0 ? best.whyWait : result.noTradeReasons;
    blocked.push({
      symbol: result.symbol,
      state: best?.scannerState ?? "NO_TRADE",
      reasons: reasons.slice(0, MAX_REASONS),
      quality: best?.quality.score ?? null,
    });
  }

  // Within a tier, the engine's own readiness ordering already applies across
  // the whole scan, so sort by quality then R:R to break ties inside the tier.
  for (const tier of tiers) {
    tier.setups.sort((a, b) => {
      if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
      return bestRr(b) - bestRr(a);
    });
  }

  return {
    tiers,
    total: tiers.reduce((sum, tier) => sum + tier.setups.length, 0),
    blocked,
    weakestStatus: weakestStatus(results.map((r) => r.dataStatus)),
    scannedAt,
    failed,
  };
}

function bestRr(setup: Setup): number {
  return setup.plans.reduce((max, plan) => Math.max(max, plan.riskReward), 0);
}
