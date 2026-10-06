import type {
  Asset,
  Candle,
  DataStatus,
  Direction,
  EntryPlan,
  MarketRegime,
  MtfAlignment,
  Phrase,
  PullbackReading,
  ScannerState,
  Setup,
  SetupStatus,
  StructureReading,
  SupplyDemandZone,
  TakeProfit,
  Timeframe,
  TrendState,
} from "@atc/types";
import { MTF_CHAIN } from "@atc/types";
import { atrAt, clamp, round } from "./indicators";
import { TREND_DIRECTION, readStructure } from "./structure";
import { buildMtfAlignment, classifyPullback, detectRegime, regimeNote } from "./context";
import { detectZones, priceInZone, zoneDistanceAtr, zoneFacts, zoneMid } from "./zones";
import { analysisConfidence, scoreSetup } from "./scoring";
import { structuralStop } from "./risk";
import {
  biasPhrase,
  directionPhrase,
  freshnessPhrase,
  impactPhrase,
  p,
  phasePhrase,
  regimePhrase,
  statusPhrase,
  trendPhrase,
  verdictPhrase,
  zoneKindPhrase,
} from "./phrases";

export interface AnalysisInput {
  asset: Asset;
  /** Candles per timeframe. The 4H/1H/15M/5M chain is required for a full read. */
  candles: Partial<Record<Timeframe, Candle[]>>;
  entryTimeframe?: Timeframe;
  dataStatus: DataStatus;
  now?: number;
}

export interface AnalysisResult {
  symbol: string;
  entryTimeframe: Timeframe;
  price: number;
  atr: number;
  structures: StructureReading[];
  zones: SupplyDemandZone[];
  regime: MarketRegime;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  setups: Setup[];
  best: Setup | null;
  dataStatus: DataStatus;
  /** Populated when the engine refuses to produce a tradable setup. */
  noTradeReasons: Phrase[];
}

const MAX_SETUPS = 3;
const APPROACH_ATR = 1.5;
const WATCH_ATR = 5;
/** A stop may reach past the zone edge to a swing, but only this far. */
const MAX_STOP_REACH_ATR = 2.5;
/** Candles price may sit in a zone before it reads as absorption, not defence. */
const ABSORPTION_CANDLES = 6;

export function analyze(input: AnalysisInput): AnalysisResult {
  const entryTimeframe = input.entryTimeframe ?? "15m";
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const symbol = input.asset.symbol;

  const readings = new Map<Timeframe, StructureReading>();
  for (const tf of MTF_CHAIN) {
    const candles = input.candles[tf];
    if (candles && candles.length >= 30) readings.set(tf, readStructure(candles, tf));
  }

  const entryCandles = input.candles[entryTimeframe] ?? [];
  const entryStructure = readings.get(entryTimeframe) ?? readStructure(entryCandles, entryTimeframe);
  const lastCandle = entryCandles[entryCandles.length - 1];
  const price = lastCandle?.close ?? 0;
  const atrValue = atrAt(entryCandles, entryCandles.length - 1);

  const htfReading = readings.get("4h") ?? readings.get("1h") ?? entryStructure;
  const htfTrend: TrendState = htfReading.trend;
  const htfDirection = TREND_DIRECTION[htfTrend];

  const regime = detectRegime(entryCandles, entryStructure);
  const pullback = classifyPullback({ candles: entryCandles, structure: entryStructure, htfDirection });
  const mtf = buildMtfAlignment(readings);

  const zones = collectZones(input, readings, htfTrend, entryTimeframe);

  const noTradeReasons = detectNoTrade({
    entryCandles,
    htfDirection,
    mtf,
    pullback,
    regime,
    zones,
    price,
    atrValue,
    dataStatus: input.dataStatus,
  });

  const candidates = rankCandidates(zones, htfDirection, price, atrValue);
  const setups: Setup[] = [];

  for (const zone of candidates.slice(0, MAX_SETUPS)) {
    const setup = buildSetup({
      asset: input.asset,
      zone,
      price,
      atrValue,
      entryCandles,
      entryStructure,
      entryTimeframe,
      htfTrend,
      regime,
      pullback,
      mtf,
      dataStatus: input.dataStatus,
      now,
      blockingReasons: noTradeReasons,
    });
    setups.push(setup);
  }

  if (setups.length === 0) {
    setups.push(
      buildNoTradeSetup({
        asset: input.asset,
        entryTimeframe,
        regime,
        pullback,
        mtf,
        htfTrend,
        dataStatus: input.dataStatus,
        now,
        reasons:
          noTradeReasons.length > 0 ? noTradeReasons : [p("noTrade.noQualifyingZone")],
        entryCandles,
        facts: entryStructure.facts,
      }),
    );
  }

  const tradable = setups.filter((s) => s.direction !== "none" && s.status !== "INVALIDATED");
  const best = tradable.length > 0 ? [...tradable].sort(byOpportunity)[0] ?? null : null;

  return {
    symbol,
    entryTimeframe,
    price,
    atr: atrValue,
    structures: [...readings.values()],
    zones,
    regime,
    pullback,
    mtf,
    setups,
    best,
    dataStatus: input.dataStatus,
    noTradeReasons,
  };
}

/**
 * Ranking order: readiness, then quality, then R:R, then HTF alignment.
 * Deliberately NOT sorted by AI confidence.
 */
export function byOpportunity(a: Setup, b: Setup): number {
  const stateRank: Record<ScannerState, number> = {
    ENTRY_NOW: 0,
    WAIT_CONFIRMATION: 1,
    LIMIT_ZONE: 2,
    WATCHLIST: 3,
    NO_TRADE: 4,
  };
  if (stateRank[a.scannerState] !== stateRank[b.scannerState]) {
    return stateRank[a.scannerState] - stateRank[b.scannerState];
  }
  if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
  const rrA = bestRr(a);
  const rrB = bestRr(b);
  if (rrB !== rrA) return rrB - rrA;
  return b.mtf.agreement - a.mtf.agreement;
}

function bestRr(setup: Setup): number {
  return setup.plans.reduce((max, plan) => Math.max(max, plan.riskReward), 0);
}

function collectZones(
  input: AnalysisInput,
  readings: Map<Timeframe, StructureReading>,
  htfTrend: TrendState,
  entryTimeframe: Timeframe,
): SupplyDemandZone[] {
  const sources: Timeframe[] = [entryTimeframe];
  for (const tf of ["1h", "4h"] as Timeframe[]) {
    if (tf !== entryTimeframe) sources.push(tf);
  }

  const out: SupplyDemandZone[] = [];
  for (const tf of sources) {
    const candles = input.candles[tf];
    if (!candles || candles.length < 40) continue;
    const reading = readings.get(tf) ?? readStructure(candles, tf);
    out.push(
      ...detectZones(candles, {
        symbol: input.asset.symbol,
        timeframe: tf,
        htfTrend,
        events: reading.events,
      }),
    );
  }
  return out;
}

function rankCandidates(
  zones: SupplyDemandZone[],
  htfDirection: "bullish" | "bearish" | "neutral",
  price: number,
  atrValue: number,
): SupplyDemandZone[] {
  const wantedKind = htfDirection === "bullish" ? "demand" : htfDirection === "bearish" ? "supply" : null;

  return zones
    .filter((z) => !z.invalidated && z.freshness !== "invalid" && z.score >= 40)
    .filter((z) => (wantedKind === null ? true : z.kind === wantedKind))
    .filter((z) => (z.kind === "demand" ? z.bottom <= price : z.top >= price))
    .filter((z) => zoneDistanceAtr(z, price, atrValue) <= WATCH_ATR)
    .sort((a, b) => {
      const da = zoneDistanceAtr(a, price, atrValue);
      const db = zoneDistanceAtr(b, price, atrValue);
      if (da !== db) return da - db;
      return b.score - a.score;
    });
}

interface NoTradeInput {
  entryCandles: Candle[];
  htfDirection: "bullish" | "bearish" | "neutral";
  mtf: MtfAlignment;
  pullback: PullbackReading;
  regime: MarketRegime;
  zones: SupplyDemandZone[];
  price: number;
  atrValue: number;
  dataStatus: DataStatus;
}

/** §30: the engine must be able to say "do not trade" and say why. */
export function detectNoTrade(input: NoTradeInput): Phrase[] {
  const reasons: Phrase[] = [];

  if (input.entryCandles.length < 60) {
    reasons.push(p("noTrade.thinHistory", { count: input.entryCandles.length }));
  }
  if (input.htfDirection === "neutral") {
    reasons.push(p("noTrade.neutralHtf"));
  }
  if (input.mtf.conflict && input.mtf.agreement < 40) {
    reasons.push(p("noTrade.timeframeDisagreement", { conflict: input.mtf.conflict }));
  }
  if (input.pullback.verdict === "reversal") {
    reasons.push(p("noTrade.reversal"));
  }
  if (input.regime === "compression") {
    reasons.push(p("noTrade.compression"));
  }

  const inRange = input.zones.some(
    (z) => !z.invalidated && zoneDistanceAtr(z, input.price, input.atrValue) <= APPROACH_ATR,
  );
  const anyQuality = input.zones.some((z) => !z.invalidated && z.score >= 55);
  if (!inRange && !anyQuality) {
    reasons.push(p("noTrade.noZoneInRange"));
  }

  return reasons;
}

interface BuildSetupInput {
  asset: Asset;
  zone: SupplyDemandZone;
  price: number;
  atrValue: number;
  entryCandles: Candle[];
  entryStructure: StructureReading;
  entryTimeframe: Timeframe;
  htfTrend: TrendState;
  regime: MarketRegime;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  dataStatus: DataStatus;
  now: number;
  blockingReasons: Phrase[];
}

function buildSetup(input: BuildSetupInput): Setup {
  const { asset, zone, price, atrValue, entryStructure, entryTimeframe, htfTrend } = input;
  const direction: Direction = zone.kind === "demand" ? "long" : "short";
  const tick = asset.minTick;

  const proximal = zone.kind === "demand" ? zone.top : zone.bottom;
  const distal = zone.kind === "demand" ? zone.bottom : zone.top;
  const distance = zoneDistanceAtr(zone, price, atrValue);
  const inside = priceInZone(zone, price);

  const confirmation = confirmationState({
    candles: input.entryCandles,
    zone,
    direction: direction === "long" ? "long" : "short",
    atrValue,
    structure: entryStructure,
  });

  const status = resolveStatus({ zone, inside, distance, confirmation });
  const scannerState = resolveScannerState(status, input.blockingReasons.length > 0);

  const stop = buildStop({ direction, zone, distal, entryStructure, atrValue, tick });
  const targets = buildTargets({
    direction,
    entryStructure,
    zone,
    price,
    atrValue,
    tick,
  });

  const plans = buildPlans({
    direction,
    zone,
    proximal,
    distal,
    price,
    stopPrice: stop.price,
    stopReason: stop.reason,
    targets,
    tick,
    confirmation,
    atrValue,
  });

  const quality = scoreSetup({
    zone,
    htfTrend,
    mtf: input.mtf,
    pullback: input.pullback,
    regime: input.regime,
    riskReward: plans.reduce((max, plan) => Math.max(max, plan.riskReward), 0),
    pendingConfirmations: confirmation.pending.length,
    direction: direction === "long" ? "long" : "short",
  });

  const aiConfidence = analysisConfidence({
    dataStatus: input.dataStatus,
    mtf: input.mtf,
    pullback: input.pullback,
    zone,
    candleCount: input.entryCandles.length,
  });

  const facts: Phrase[] = [
    p("setup.fact.price", {
      price: round(price, tick),
      tf: entryTimeframe,
      atr: round(atrValue, tick),
    }),
    ...input.mtf.legs.map((leg) =>
      p("mtf.leg", {
        tf: leg.timeframe,
        trend: trendPhrase(leg.trend),
        phase: phasePhrase(leg.phase),
      }),
    ),
    p("mtf.agreement", { agreement: input.mtf.agreement }),
    ...entryStructure.facts,
    ...zoneFacts(zone),
    p("setup.fact.distance", { distance }),
    ...confirmation.facts,
    p("setup.fact.quality", { score: quality.score, grade: quality.grade }),
    p("setup.fact.confidence", { confidence: aiConfidence }),
    p("setup.fact.dataQuality", {
      quality: input.dataStatus.quality,
      provider: input.dataStatus.provider,
      count: input.dataStatus.candleCount,
    }),
  ];

  const interpretation = buildInterpretation({
    direction,
    zone,
    htfTrend,
    regime: input.regime,
    pullback: input.pullback,
    mtf: input.mtf,
    status,
    quality: quality.score,
  });

  const assumptions: Phrase[] = [
    p("setup.assume.htfHolds"),
    p("setup.assume.zoneIntact"),
    p("setup.assume.candlesComplete", { provider: input.dataStatus.provider }),
    p("setup.assume.disciplinedFill"),
  ];
  if (input.dataStatus.quality !== "LIVE") {
    assumptions.push(p("setup.assume.dataNotLive", { quality: input.dataStatus.quality }));
  }

  const whyEnter = buildWhyEnter({ direction, zone, htfTrend, quality: quality.score, confirmation, targets });
  const whyWait = buildWhyWait({
    confirmation,
    status,
    distance,
    pullback: input.pullback,
    mtf: input.mtf,
    regime: input.regime,
    blockingReasons: input.blockingReasons,
  });

  const invalidation = buildInvalidation({ direction, zone, distal, entryStructure, tick, atrValue });

  return {
    id: `${asset.symbol}-${zone.id}`,
    symbol: asset.symbol,
    timeframe: entryTimeframe,
    direction,
    status,
    scannerState,
    regime: input.regime,
    quality,
    aiConfidence,
    zone,
    pullback: input.pullback,
    mtf: input.mtf,
    plans,
    confirmationRequired: confirmation.pending,
    whyEnter,
    whyWait,
    invalidation,
    facts,
    interpretation,
    assumptions,
    dataStatus: input.dataStatus,
    createdAt: zone.createdTime,
    updatedAt: input.now,
  };
}

export interface ConfirmationState {
  /** Conditions that are already visible on the chart. */
  met: Phrase[];
  /** Conditions still required before the entry is valid. */
  pending: Phrase[];
  facts: Phrase[];
  /** True when every required condition is met. */
  complete: boolean;
}

function confirmationState(params: {
  candles: Candle[];
  zone: SupplyDemandZone;
  direction: "long" | "short";
  atrValue: number;
  structure: StructureReading;
}): ConfirmationState {
  const { candles, zone, direction, atrValue, structure } = params;
  const met: Phrase[] = [];
  const pending: Phrase[] = [];
  const facts: Phrase[] = [];

  const recent = candles.slice(-6);
  const touched = recent.some((c) => c.low <= zone.top && c.high >= zone.bottom);

  const rejection = recent.find((c) => {
    const body = Math.abs(c.close - c.open);
    const range = Math.max(c.high - c.low, 1e-9);
    const wick = direction === "long" ? Math.min(c.open, c.close) - c.low : c.high - Math.max(c.open, c.close);
    const rightWay = direction === "long" ? c.close > c.open : c.close < c.open;
    return rightWay && wick > body * 0.8 && range / atrValue > 0.6;
  });
  if (rejection) {
    met.push(p("confirm.met.rejection"));
    facts.push(
      p("confirm.fact.rejection", {
        side: p(direction === "long" ? "label.side.up" : "label.side.down"),
      }),
    );
  } else {
    pending.push(
      p(direction === "long" ? "confirm.pending.rejectionLong" : "confirm.pending.rejectionShort"),
    );
  }

  const wanted = direction === "long" ? "bullish" : "bearish";
  // Search backwards: the *newest* qualifying event is the one that matters.
  // `.find()` here would return the oldest of the window and never pass the
  // recency test below, which made ENTRY_VALID unreachable.
  const shift = [...structure.events]
    .reverse()
    .find((e) => e.direction === wanted && (e.type === "CHOCH" || e.type === "MSS" || e.type === "BOS"));
  if (shift && candles.length - shift.index <= 12) {
    met.push(p("confirm.met.shift", { type: shift.type, bias: biasPhrase(shift.direction) }));
    facts.push(
      p("confirm.fact.shift", {
        type: shift.type,
        bias: biasPhrase(shift.direction),
        price: shift.price,
        displacement: shift.displacement,
      }),
    );
  } else {
    pending.push(p("confirm.pending.shift", { bias: biasPhrase(wanted) }));
  }

  const displacement = recent.find((c) => {
    const body = Math.abs(c.close - c.open);
    const rightWay = direction === "long" ? c.close > c.open : c.close < c.open;
    return rightWay && body / atrValue >= 0.8;
  });
  if (displacement) {
    met.push(p("confirm.met.displacement"));
  } else {
    pending.push(p("confirm.pending.displacement"));
  }

  if (!touched) {
    facts.push(p("confirm.fact.notTouched"));
  }

  return { met, pending, facts, complete: pending.length === 0 };
}

function resolveStatus(params: {
  zone: SupplyDemandZone;
  inside: boolean;
  distance: number;
  confirmation: ConfirmationState;
}): SetupStatus {
  const { zone, inside, distance, confirmation } = params;
  if (zone.invalidated || zone.freshness === "invalid") return "INVALIDATED";
  if (inside) {
    if (confirmation.complete) return "ENTRY_VALID";
    if (confirmation.met.length > 0) return "WAITING_CONFIRMATION";
    return "IN_ZONE";
  }
  if (confirmation.complete && distance <= APPROACH_ATR) return "ENTRY_VALID";
  if (distance <= APPROACH_ATR) return "ZONE_APPROACHING";
  return "WATCHING";
}

function resolveScannerState(status: SetupStatus, blocked: boolean): ScannerState {
  if (status === "INVALIDATED") return "NO_TRADE";
  if (blocked) return status === "WATCHING" ? "NO_TRADE" : "WATCHLIST";
  switch (status) {
    case "ENTRY_VALID":
      return "ENTRY_NOW";
    case "WAITING_CONFIRMATION":
    case "IN_ZONE":
      return "WAIT_CONFIRMATION";
    case "ZONE_APPROACHING":
      return "LIMIT_ZONE";
    default:
      return "WATCHLIST";
  }
}

function buildStop(params: {
  direction: Direction;
  zone: SupplyDemandZone;
  distal: number;
  entryStructure: StructureReading;
  atrValue: number;
  tick: number;
}): { price: number; reason: Phrase } {
  const { direction, distal, entryStructure, atrValue, tick } = params;
  const dir = direction === "short" ? "short" : "long";
  const swing = dir === "long" ? entryStructure.lastSwingLow : entryStructure.lastSwingHigh;

  let level = distal;
  let label: Phrase = p("risk.stop.zoneEdge");
  if (swing) {
    const beyond = dir === "long" ? swing.price < distal : swing.price > distal;
    // Only reach past the zone edge when the swing is a *sane* distance away.
    // An unbounded swing stop produced stops up to 18 ATR wide, which no
    // position size can make sense of.
    const reach = Math.abs(swing.price - distal) / Math.max(atrValue, 1e-9);
    if (beyond && reach <= MAX_STOP_REACH_ATR) {
      level = swing.price;
      label = p("risk.stop.protectedSwing", {
        side: p(dir === "long" ? "label.side.swingLow" : "label.side.swingHigh"),
      });
    }
  }

  const suggestion = structuralStop(dir, level, atrValue, label);
  return { price: round(suggestion.price, tick), reason: suggestion.reason };
}

/**
 * Targets are projected from the **planned entry area**, not from wherever
 * price happens to be right now, because that is the level `makePlan` measures
 * risk from. Anchoring them on current price made R:R move inversely with
 * distance to the zone — tiny when price was actually in the zone and ready to
 * trade, flattering when it was nowhere near it.
 *
 * The measured move uses the zone's own impulse leg (`distanceTravelled`, in
 * ATR), i.e. how far price actually ran when these orders last fired.
 */
function buildTargets(params: {
  direction: Direction;
  entryStructure: StructureReading;
  zone: SupplyDemandZone;
  price: number;
  atrValue: number;
  tick: number;
}): { price: number; label: string; reason: Phrase }[] {
  const { direction, entryStructure, zone, atrValue, tick } = params;
  const dir = direction === "short" ? "short" : "long";
  const out: { price: number; label: string; reason: Phrase }[] = [];
  const anchor = zoneMid(zone);

  const opposing = dir === "long" ? entryStructure.lastSwingHigh : entryStructure.lastSwingLow;
  if (opposing) {
    const valid = dir === "long" ? opposing.price > anchor : opposing.price < anchor;
    if (valid) {
      out.push({
        price: round(opposing.price, tick),
        label: "TP1",
        reason: p("target.priorSwing", {
          swing: p(dir === "long" ? "label.side.swingHigh" : "label.side.swingLow"),
        }),
      });
    }
  }

  const legSize = Math.max(zone.distanceTravelled, 1) * atrValue;
  const measured = dir === "long" ? anchor + legSize * 1.5 : anchor - legSize * 1.5;
  out.push({
    price: round(measured, tick),
    label: out.length === 0 ? "TP1" : "TP2",
    reason: p("target.measuredMove"),
  });

  const extension = dir === "long" ? anchor + atrValue * 6 : anchor - atrValue * 6;
  out.push({
    price: round(extension, tick),
    label: out.length === 1 ? "TP2" : "TP3",
    reason: p("target.trendExtension"),
  });

  return out;
}

function buildPlans(params: {
  direction: Direction;
  zone: SupplyDemandZone;
  proximal: number;
  distal: number;
  price: number;
  stopPrice: number;
  stopReason: Phrase;
  targets: { price: number; label: string; reason: Phrase }[];
  tick: number;
  confirmation: ConfirmationState;
  atrValue: number;
}): EntryPlan[] {
  const { direction, zone, proximal, distal, stopPrice, stopReason, targets, tick, confirmation, atrValue } = params;
  const dir = direction === "short" ? "short" : "long";
  const mid = zoneMid(zone);

  const aggressiveEntry: [number, number] =
    dir === "long" ? [distal, mid] : [mid, distal];
  const balancedEntry: [number, number] =
    dir === "long" ? [mid, proximal] : [proximal, mid];
  const conservativeOffset = atrValue * 0.5;
  const conservativeEntry: [number, number] =
    dir === "long"
      ? [proximal, proximal + conservativeOffset]
      : [proximal - conservativeOffset, proximal];

  const plans: EntryPlan[] = [];

  plans.push(
    makePlan({
      id: `${zone.id}-conservative`,
      name: "Conservative",
      entryType: "retest",
      range: conservativeEntry,
      dir,
      stopPrice,
      stopReason,
      targets,
      tick,
      sizeFraction: 1,
      notes: [p("plan.note.conservative1"), p("plan.note.conservative2")],
    }),
  );

  plans.push(
    makePlan({
      id: `${zone.id}-balanced`,
      name: "Balanced",
      entryType: "confirmation",
      range: balancedEntry,
      dir,
      stopPrice,
      stopReason,
      targets,
      tick,
      sizeFraction: 1,
      notes: [
        p("plan.note.balanced"),
        confirmation.complete
          ? p("plan.note.balancedLive")
          : p("plan.note.balancedPending", {
              condition: confirmation.pending[0] ?? p("confirm.pending.displacement"),
            }),
      ],
    }),
  );

  plans.push(
    makePlan({
      id: `${zone.id}-aggressive`,
      name: "Aggressive",
      entryType: confirmation.complete ? "aggressive" : "probe",
      range: aggressiveEntry,
      dir,
      stopPrice,
      stopReason,
      targets,
      tick,
      sizeFraction: confirmation.complete ? 1 : 0.5,
      notes: confirmation.complete
        ? [p("plan.note.aggressiveLimit")]
        : [p("plan.note.probe1"), p("plan.note.probe2")],
    }),
  );

  return plans;
}

function makePlan(params: {
  id: string;
  name: EntryPlan["name"];
  entryType: EntryPlan["entryType"];
  range: [number, number];
  dir: "long" | "short";
  stopPrice: number;
  stopReason: Phrase;
  targets: { price: number; label: string; reason: Phrase }[];
  tick: number;
  sizeFraction: number;
  notes: Phrase[];
}): EntryPlan {
  const { id, name, entryType, range, dir, stopPrice, stopReason, targets, tick, sizeFraction, notes } = params;
  const low = round(Math.min(range[0], range[1]), tick);
  const high = round(Math.max(range[0], range[1]), tick);
  const bestPrice = dir === "long" ? low : high;
  const saferPrice = dir === "long" ? high : low;
  const reference = (low + high) / 2;
  const risk = Math.abs(reference - stopPrice);

  const takeProfits: TakeProfit[] = targets.map((t) => ({
    price: t.price,
    label: t.label,
    reason: t.reason,
    rr: risk > 0 ? Number((Math.abs(t.price - reference) / risk).toFixed(2)) : 0,
  }));

  return {
    id,
    name,
    entryType,
    entryZone: { low, high },
    bestPrice,
    saferPrice,
    stopLoss: stopPrice,
    stopLossReason: stopReason,
    takeProfits,
    riskReward: takeProfits[0]?.rr ?? 0,
    sizeFraction,
    notes,
  };
}

function buildWhyEnter(params: {
  direction: Direction;
  zone: SupplyDemandZone;
  htfTrend: TrendState;
  quality: number;
  confirmation: ConfirmationState;
  targets: { label: string; reason: Phrase }[];
}): Phrase[] {
  const { direction, zone, htfTrend, quality, confirmation, targets } = params;
  const out: Phrase[] = [];

  out.push(
    p("setup.enter.withTrend", {
      trend: trendPhrase(htfTrend),
      direction: directionPhrase(direction),
    }),
  );
  out.push(
    p("setup.enter.zoneQuality", {
      kind: zoneKindPhrase(zone.kind),
      freshness: freshnessPhrase(zone.freshness),
      strength: zone.reactionStrength,
      displacement: zone.displacement,
    }),
  );
  if (zone.structuralImpact !== "none") {
    // The impact label already reads "caused a BOS", so the template must not
    // prepend "caused a" again — that is what produced "caused a caused bos".
    out.push(p("setup.enter.trackRecord", { impact: impactPhrase(zone.structuralImpact) }));
  }
  if (zone.htfAligned) out.push(p("setup.enter.htfAligned"));
  for (const m of confirmation.met) out.push(m);
  const first = targets[0];
  if (first) out.push(p("setup.enter.hasTarget", { reason: first.reason }));
  out.push(p("setup.enter.score", { score: quality }));

  return out;
}

function buildWhyWait(params: {
  confirmation: ConfirmationState;
  status: SetupStatus;
  distance: number;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  regime: MarketRegime;
  blockingReasons: Phrase[];
}): Phrase[] {
  const { confirmation, status, distance, pullback, mtf, regime, blockingReasons } = params;
  const out: Phrase[] = [];

  if (status === "WATCHING" || status === "ZONE_APPROACHING") {
    out.push(p("setup.wait.midRange", { distance }));
  }
  for (const condition of confirmation.pending) out.push(p("setup.wait.missing", { condition }));
  if (pullback.verdict !== "pullback") {
    out.push(
      p("setup.wait.notPullback", {
        verdict: verdictPhrase(pullback.verdict),
        strength: pullback.strength,
      }),
    );
  }
  if (mtf.conflict) out.push(p("setup.wait.conflict", { conflict: mtf.conflict }));
  // regimeNote is total over MarketRegime, so there is nothing to guard against.
  out.push(regimeNote(regime));
  for (const r of blockingReasons) out.push(r);

  if (out.length === 0) {
    out.push(p("setup.wait.nothingOutstanding"));
  }
  return out;
}

function buildInvalidation(params: {
  direction: Direction;
  zone: SupplyDemandZone;
  distal: number;
  entryStructure: StructureReading;
  tick: number;
  atrValue: number;
}): Phrase[] {
  const { direction, zone, distal, entryStructure, tick } = params;
  const dir = direction === "short" ? "short" : "long";
  const out: Phrase[] = [];

  out.push(
    p("setup.invalid.closeBeyondZone", {
      side: p(dir === "long" ? "label.side.below" : "label.side.above"),
      price: round(distal, tick),
    }),
  );
  const counterSwing = dir === "long" ? entryStructure.lastSwingLow : entryStructure.lastSwingHigh;
  if (counterSwing) {
    out.push(
      p("setup.invalid.counterChoch", {
        bias: biasPhrase(dir === "long" ? "bearish" : "bullish"),
        price: round(counterSwing.price, tick),
      }),
    );
  }
  // Absorption is a count of candles, not a price distance. The old wording
  // multiplied ATR by 3 and called the result a number of candles.
  out.push(p("setup.invalid.absorbed", { candles: ABSORPTION_CANDLES }));
  out.push(
    zone.tests >= 2
      ? p("setup.invalid.testedAlready", { tests: zone.tests })
      : p("setup.invalid.secondTest"),
  );
  out.push(p("setup.invalid.keptInHistory"));
  return out;
}

function buildInterpretation(params: {
  direction: Direction;
  zone: SupplyDemandZone;
  htfTrend: TrendState;
  regime: MarketRegime;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  status: SetupStatus;
  quality: number;
}): Phrase[] {
  const { direction, zone, htfTrend, regime, pullback, mtf, status, quality } = params;
  const out: Phrase[] = [];

  out.push(
    p("setup.read.shape", {
      trend: trendPhrase(htfTrend),
      verdict: verdictPhrase(pullback.verdict),
      tf: zone.timeframe,
      kind: zoneKindPhrase(zone.kind),
    }),
  );
  out.push(p("setup.read.regime", { regime: regimePhrase(regime) }));
  out.push(
    mtf.conflict
      ? p("setup.read.chainConflict", { agreement: mtf.agreement, conflict: mtf.conflict })
      : p("setup.read.chainClean", { agreement: mtf.agreement }),
  );
  out.push(p("setup.read.lifecycle", { status: statusPhrase(status), score: quality }));
  out.push(
    p("setup.read.defenders", {
      side: p(direction === "long" ? "setup.read.buyers" : "setup.read.sellers"),
    }),
  );
  out.push(p("setup.read.zoneHasOrders", { displacement: zone.displacement }));
  return out;
}

function buildNoTradeSetup(params: {
  asset: Asset;
  entryTimeframe: Timeframe;
  regime: MarketRegime;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  htfTrend: TrendState;
  dataStatus: DataStatus;
  now: number;
  reasons: Phrase[];
  entryCandles: Candle[];
  facts: Phrase[];
}): Setup {
  const { asset, entryTimeframe, regime, pullback, mtf, htfTrend, dataStatus, now, reasons, entryCandles, facts } =
    params;

  const quality = scoreSetup({
    zone: null,
    htfTrend,
    mtf,
    pullback,
    regime,
    riskReward: 0,
    pendingConfirmations: 4,
    direction: "none",
  });

  const plan: EntryPlan = {
    id: `${asset.symbol}-no-trade`,
    name: "No Trade",
    entryType: "probe",
    entryZone: { low: 0, high: 0 },
    bestPrice: 0,
    saferPrice: 0,
    stopLoss: 0,
    stopLossReason: p("plan.stop.none"),
    takeProfits: [],
    riskReward: 0,
    sizeFraction: 0,
    notes: [p("plan.note.noTrade")],
  };

  return {
    id: `${asset.symbol}-${entryTimeframe}-no-trade`,
    symbol: asset.symbol,
    timeframe: entryTimeframe,
    direction: "none",
    status: "WATCHING",
    scannerState: "NO_TRADE",
    regime,
    quality,
    aiConfidence: analysisConfidence({
      dataStatus,
      mtf,
      pullback,
      zone: null,
      candleCount: entryCandles.length,
    }),
    zone: null,
    pullback,
    mtf,
    plans: [plan],
    confirmationRequired: [],
    whyEnter: [],
    whyWait: reasons,
    invalidation: [p("setup.invalid.noTradeChanges")],
    facts,
    interpretation: [
      p("setup.read.noSetup"),
      p("setup.read.noSetupContext", {
        regime: regimePhrase(regime),
        trend: trendPhrase(htfTrend),
      }),
    ],
    assumptions: [p("setup.assume.notLookingForReason")],
    dataStatus,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * §24: re-entry requires a genuinely new setup, not the same idea restated.
 *
 * The missing-confirmation check runs **before** the direction check on
 * purpose. Testing direction first let the classic flip-flop revenge trade
 * through: lose a long, immediately take an unconfirmed short, and call it
 * "a new idea because the structure shifted".
 */
export function isValidReEntry(previous: Setup, candidate: Setup): { valid: boolean; reason: Phrase } {
  if (previous.symbol !== candidate.symbol) {
    return { valid: true, reason: p("reentry.ok.differentSymbol") };
  }
  if (previous.zone && candidate.zone && previous.zone.id === candidate.zone.id) {
    return { valid: false, reason: p("reentry.no.sameZone") };
  }
  const missing = candidate.confirmationRequired[0];
  if (missing) {
    return {
      valid: false,
      reason: p("reentry.no.missingConfirmation", { condition: missing }),
    };
  }
  if (previous.direction !== candidate.direction) {
    return { valid: true, reason: p("reentry.ok.oppositeDirection") };
  }
  if (candidate.quality.score < previous.quality.score) {
    return {
      valid: false,
      reason: p("reentry.no.lowerScore", {
        candidate: candidate.quality.score,
        previous: previous.quality.score,
      }),
    };
  }
  return { valid: true, reason: p("reentry.ok.freshConfirmation") };
}

export function setupProgress(setup: Setup): number {
  const order: SetupStatus[] = [
    "WATCHING",
    "ZONE_APPROACHING",
    "IN_ZONE",
    "WAITING_CONFIRMATION",
    "ENTRY_VALID",
    "ACTIVE",
    "MANAGING",
    "COMPLETED",
  ];
  const index = order.indexOf(setup.status);
  if (index < 0) return 0;
  return clamp(Math.round((index / (order.length - 1)) * 100), 0, 100);
}
