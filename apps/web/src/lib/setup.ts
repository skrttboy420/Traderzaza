import type { EntryPlan, Setup } from "@atc/types";

/**
 * The plan we lead with on cards and in the chart: Balanced if the engine
 * produced one, otherwise the first plan. Never silently pick the most
 * aggressive option for the user.
 */
export function primaryPlan(setup: Setup): EntryPlan | null {
  return setup.plans.find((p) => p.name === "Balanced") ?? setup.plans[0] ?? null;
}

export function bestRiskReward(setup: Setup): number {
  return setup.plans.reduce((max, plan) => Math.max(max, plan.riskReward), 0);
}

export function isTradable(setup: Setup): boolean {
  return setup.scannerState !== "NO_TRADE" && setup.direction !== "none";
}

export function isInvalidated(setup: Setup): boolean {
  return setup.status === "INVALIDATED";
}

/** Stable, URL-safe id for linking a setup from a list to its detail page. */
export function setupHref(setup: Setup): string {
  return `/setups/${encodeURIComponent(setup.symbol)}?setup=${encodeURIComponent(setup.id)}`;
}

export function symbolHref(symbol: string): string {
  return `/setups/${encodeURIComponent(symbol)}`;
}
