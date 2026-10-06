/**
 * A sentence the engine wants to say, identified rather than written.
 *
 * The engine does the maths and decides *which* sentence applies; it never
 * decides what language that sentence is in. `key` indexes the phrase
 * catalogue in `@atc/engine/phrases`, which holds the English and Thai
 * templates side by side, and `vars` carries the already-computed numbers.
 *
 * This is the whole reason the Thai UI stopped leaking English: there is no
 * English string anywhere on the path from a candle to the screen.
 */
export interface Phrase {
  key: string;
  vars?: Record<string, PhraseVar>;
}

/**
 * A nested `Phrase` is how enum labels get localised — `{trend}` in a template
 * is itself a phrase (`trend.strong_bullish`), so there is one catalogue and
 * one rendering path rather than a separate label system.
 */
export type PhraseVar = string | number | Phrase;

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

/** Mandatory multi-timeframe chain: HTF bias -> intermediate -> entry -> trigger. */
export const MTF_CHAIN: Timeframe[] = ["4h", "1h", "15m", "5m"];

export interface Candle {
  /** Unix seconds, candle open time. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AssetClass = "forex" | "metal" | "crypto" | "index" | "stock" | "etf";

export interface Asset {
  symbol: string;
  display: string;
  assetClass: AssetClass;
  /** Smallest price increment used for rounding on charts and in text. */
  minTick: number;
  /** Price distance of one pip/point used by the risk calculator. */
  pipSize: number;
  /** Account-currency value of one pip per 1.0 lot. Null when not applicable (crypto). */
  pipValuePerLot: number | null;
  quote: string;
}

export type DataQuality = "LIVE" | "DELAYED" | "DEMO";

export interface DataStatus {
  quality: DataQuality;
  provider: string;
  /** Unix seconds of the newest candle received. */
  lastCandleTime: number;
  candleCount: number;
  note?: string;
}

export type SwingType = "HH" | "HL" | "LH" | "LL";

export interface Swing {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
  label: SwingType | null;
}

export type StructureEventType = "BOS" | "CHOCH" | "MSS";

export interface StructureEvent {
  type: StructureEventType;
  direction: "bullish" | "bearish";
  index: number;
  time: number;
  price: number;
  brokenSwingTime: number;
  /** Close-to-close displacement of the breaking candle, in ATR multiples. */
  displacement: number;
}

export type TrendState =
  | "strong_bullish"
  | "bullish"
  | "weak_bullish"
  | "ranging"
  | "transition"
  | "weak_bearish"
  | "bearish"
  | "strong_bearish";

export type TrendPhase =
  | "continuation"
  | "weakening"
  | "reversal_risk"
  | "consolidation"
  | "expansion"
  | "compression";

export interface StructureReading {
  timeframe: Timeframe;
  swings: Swing[];
  events: StructureEvent[];
  trend: TrendState;
  phase: TrendPhase;
  lastSwingHigh: Swing | null;
  lastSwingLow: Swing | null;
  /** Facts the LLM may quote verbatim, once rendered in the reader's language. */
  facts: Phrase[];
}

export type MarketRegime =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "expansion"
  | "compression"
  | "high_volatility"
  | "low_volatility";

export type ZoneKind = "demand" | "supply";

export type ZoneFreshness =
  | "fresh"
  | "tested_once"
  | "tested_twice"
  | "tested_multiple"
  | "weak"
  | "invalid";

export type ZoneStructuralImpact =
  | "caused_bos"
  | "caused_choch"
  | "caused_mss"
  | "strong_rejection"
  | "continuation"
  | "none";

export interface SupplyDemandZone {
  id: string;
  kind: ZoneKind;
  timeframe: Timeframe;
  top: number;
  bottom: number;
  createdIndex: number;
  createdTime: number;
  freshness: ZoneFreshness;
  tests: number;
  /** 0-100, how violently price left the zone the first time. */
  reactionStrength: number;
  structuralImpact: ZoneStructuralImpact;
  htfAligned: boolean;
  /** 0-100 zone quality. Never a win probability. */
  score: number;
  /** Departure displacement in ATR multiples. */
  displacement: number;
  /** Candles spent inside the base before the impulse. */
  timeInZone: number;
  /** Distance price travelled away from the zone, in ATR multiples. */
  distanceTravelled: number;
  invalidated: boolean;
}

export type PullbackVerdict = "pullback" | "reversal" | "unclear";

export interface PullbackReading {
  verdict: PullbackVerdict;
  /** 0-100 — confidence of the deterministic classifier, not of the LLM. */
  strength: number;
  reasons: Phrase[];
}

export type SetupStatus =
  | "WATCHING"
  | "ZONE_APPROACHING"
  | "IN_ZONE"
  | "WAITING_CONFIRMATION"
  | "ENTRY_VALID"
  | "ACTIVE"
  | "MANAGING"
  | "COMPLETED"
  | "INVALIDATED";

export type ScannerState =
  | "ENTRY_NOW"
  | "WAIT_CONFIRMATION"
  | "LIMIT_ZONE"
  | "WATCHLIST"
  | "NO_TRADE";

export type EntryType = "aggressive" | "confirmation" | "retest" | "probe";

export type Direction = "long" | "short" | "none";

export interface PriceRange {
  low: number;
  high: number;
}

export interface TakeProfit {
  price: number;
  label: string;
  reason: Phrase;
  rr: number;
}

export interface EntryPlan {
  id: string;
  name: "Conservative" | "Balanced" | "Aggressive" | "No Trade";
  entryType: EntryType;
  entryZone: PriceRange;
  /** Edge of the zone — better price, higher chance of being skipped. */
  bestPrice: number;
  /** Price after confirmation — worse fill, less guesswork. */
  saferPrice: number;
  stopLoss: number;
  stopLossReason: Phrase;
  takeProfits: TakeProfit[];
  riskReward: number;
  /** Fraction of the user's normal risk unit. Probe entries are < 1. */
  sizeFraction: number;
  notes: Phrase[];
}

export interface ScoreComponent {
  key: string;
  label: Phrase;
  /** Contribution weight, 0-1. Weights sum to 1 across components. */
  weight: number;
  /** 0-100 score for this component alone. */
  score: number;
  note: Phrase;
}

export interface SetupQuality {
  /** 0-100 "Setup Quality Score". NOT a win probability. */
  score: number;
  grade: "A" | "B" | "C" | "D";
  components: ScoreComponent[];
}

export interface MtfAlignment {
  /** Per-timeframe trend read, HTF first. */
  legs: { timeframe: Timeframe; trend: TrendState; phase: TrendPhase }[];
  /** 0-100 — how much the chain agrees. */
  agreement: number;
  conflict: Phrase | null;
}

export interface Setup {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  status: SetupStatus;
  scannerState: ScannerState;
  regime: MarketRegime;
  quality: SetupQuality;
  /** Separate from quality: how sure the analysis layer is about its own read. */
  aiConfidence: number;
  zone: SupplyDemandZone | null;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  plans: EntryPlan[];
  confirmationRequired: Phrase[];
  whyEnter: Phrase[];
  whyWait: Phrase[];
  invalidation: Phrase[];
  facts: Phrase[];
  interpretation: Phrase[];
  assumptions: Phrase[];
  dataStatus: DataStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SetupEvent {
  setupId: string;
  at: number;
  from: SetupStatus;
  to: SetupStatus;
  reason: string;
}

export type TradeClassification =
  | "valid_loss"
  | "bad_setup"
  | "good_setup_bad_execution"
  | "emotional_trade"
  | "missed_trade"
  | "valid_win";

export type PsychologyTag =
  | "fomo"
  | "revenge"
  | "overconfidence"
  | "early_entry"
  | "late_entry"
  | "oversizing"
  | "moved_stop"
  | "early_breakeven"
  | "emotional_reentry"
  | "over_analysis"
  | "refused_valid_setup";

export interface Trade {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: Exclude<Direction, "none">;
  entryType: EntryType;
  entryPrice: number;
  stopLoss: number;
  takeProfits: number[];
  size: number;
  openedAt: number;
  closedAt: number | null;
  exitPrice: number | null;
  /** Max favourable / adverse excursion in R multiples. */
  mfeR: number | null;
  maeR: number | null;
  resultR: number | null;
  classification: TradeClassification | null;
  psychology: PsychologyTag[];
  setupId: string | null;
  notes: string;
}

export interface RiskInput {
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  asset: Asset;
}

export interface RiskOutput {
  riskAmount: number;
  stopDistance: number;
  stopDistancePips: number;
  /** Lots for FX/metals, units for crypto. */
  positionSize: number;
  unit: "lots" | "units";
  warnings: Phrase[];
}

export interface ScanResult {
  symbol: string;
  setups: Setup[];
  best: Setup | null;
  dataStatus: DataStatus;
}

export type Locale = "th" | "en";

export type ExplanationLevel = "beginner" | "intermediate" | "advanced";
