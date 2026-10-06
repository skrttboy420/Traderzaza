import type { ExplanationLevel, Timeframe } from "@atc/types";

export type CoachMode = "coach" | "direct";

export interface ChartLayers {
  swings: boolean;
  structure: boolean;
  zones: boolean;
  entries: boolean;
}

export interface UserSettings {
  accountBalance: number;
  currency: string;
  riskPercent: number;
  smallAccountMode: boolean;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  watchlist: string[];
  entryTimeframe: Timeframe;
  coachMode: CoachMode;
  explanationLevel: ExplanationLevel;
  showAiConfidence: boolean;
  chartLayers: ChartLayers;
  refreshSeconds: number;
  alerts: {
    newSetup: boolean;
    entryValid: boolean;
    approaching: boolean;
    invalidated: boolean;
    qualityJump: boolean;
    minGrade: "A" | "B" | "C" | "D";
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  accountBalance: 1000,
  currency: "USD",
  riskPercent: 1,
  smallAccountMode: true,
  maxTradesPerDay: 3,
  maxOpenPositions: 2,
  watchlist: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT"],
  entryTimeframe: "15m",
  coachMode: "coach",
  explanationLevel: "intermediate",
  showAiConfidence: true,
  chartLayers: { swings: true, structure: true, zones: true, entries: true },
  refreshSeconds: 60,
  alerts: {
    newSetup: true,
    entryValid: true,
    approaching: true,
    invalidated: true,
    qualityJump: false,
    minGrade: "C",
  },
};

/**
 * Merges stored settings over the defaults one level deep so that adding a new
 * setting never breaks an existing browser's saved object.
 */
export function mergeSettings(stored: unknown): UserSettings {
  if (typeof stored !== "object" || stored === null) return DEFAULT_SETTINGS;
  const raw = stored as Partial<UserSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    chartLayers: { ...DEFAULT_SETTINGS.chartLayers, ...(raw.chartLayers ?? {}) },
    alerts: { ...DEFAULT_SETTINGS.alerts, ...(raw.alerts ?? {}) },
    watchlist:
      Array.isArray(raw.watchlist) && raw.watchlist.length > 0
        ? raw.watchlist.filter((s): s is string => typeof s === "string")
        : DEFAULT_SETTINGS.watchlist,
  };
}
