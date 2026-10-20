import { maxAffordableStop, type AffordableStop } from "@atc/engine";
import { getAsset } from "@atc/market-data";
import type { Setup } from "@atc/types";

import { primaryPlan } from "./setup";
import type { UserSettings } from "./settings";

/**
 * "Can this account actually take this trade?"
 *
 * Computed in the browser, not in the scan, and that split is not an accident:
 * the scan is about the market and is identical for everyone, while the balance
 * is personal and lives in localStorage. Pushing the balance to the server to
 * get an affordability flag back would make the scan per-user for no gain, and
 * on the metered feed a per-user scan is a per-user bill.
 *
 * The consequence worth knowing: this is a client-only annotation. The server
 * HTML never contains it, and it appears after hydration.
 */
export interface SetupAffordability {
  /** The widest stop this account can take on this instrument. */
  ceiling: AffordableStop;
  /** This plan's stop, measured from the fill the trader is most likely to get. */
  stopDistance: number;
  stopPoints: number;
  affordable: boolean;
  /**
   * Balance that would make this stop affordable at the current risk percent.
   * Only meaningful when `affordable` is false.
   *
   * Linear in the balance, because everything upstream of it is: the minimum
   * lot is fixed and the risk amount is a straight percentage, so doubling the
   * account exactly doubles the stop it can carry.
   */
  balanceNeeded: number;
}

export function setupAffordability(
  setup: Setup,
  settings: UserSettings,
): SetupAffordability | null {
  const asset = getAsset(setup.symbol);
  if (!asset) return null;

  const ceiling = maxAffordableStop(settings.accountBalance, settings.riskPercent, asset);
  if (!ceiling || ceiling.distance <= 0) return null;

  const plan = primaryPlan(setup);
  if (!plan || plan.name === "No Trade") return null;

  // Measured from `saferPrice`, the post-confirmation fill, rather than from
  // the zone edge. That is both the fill most trades actually get and the wider
  // of the two distances, so an "affordable" badge here is never contradicted
  // by the risk calculator on the detail page.
  const stopDistance = Math.abs(plan.saferPrice - plan.stopLoss);
  if (stopDistance <= 0) return null;

  const stopPoints = asset.minTick > 0 ? Math.round(stopDistance / asset.minTick) : 0;

  return {
    ceiling,
    stopDistance,
    stopPoints,
    affordable: stopDistance <= ceiling.distance,
    balanceNeeded: Math.ceil((settings.accountBalance * stopDistance) / ceiling.distance),
  };
}
