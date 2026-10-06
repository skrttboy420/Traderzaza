"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReplayController,
  analyze,
  resolvePracticeCall,
  type PracticeResolution,
} from "@atc/engine";
import { getAsset } from "@atc/market-data";
import {
  MTF_CHAIN,
  type Asset,
  type Candle,
  type DataStatus,
  type Direction,
  type Phrase,
  type Timeframe,
} from "@atc/types";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { PriceChart } from "@/components/PriceChart";
import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, Disclaimer, Empty, Row, SectionTitle, Stat, cx } from "@/components/ui";
import { SCANNER_VISUAL, directionVisual } from "@/components/visual";
import { useLocale, useT } from "@/i18n/provider";
import { formatPercent, formatPrice, formatR, formatTime, timeframeLabel } from "@/lib/format";
import { primaryPlan } from "@/lib/setup";
import { useSettings } from "@/lib/store";

/** Timeframes that can drive the replay clock. Must exist in the MTF chain. */
const DRIVERS: Timeframe[] = ["5m", "15m", "1h"];
const LOAD_LIMIT = 1000;
const START_INDEX = 150;
const PLAY_MS = 900;
/** Candles a call gets to resolve before we settle it at market. */
const WINDOW = 24;
/** Fallback stop when the engine offered no plan, so a call is still measurable. */
const FALLBACK_STOP_ATR = 1.5;
const FALLBACK_RR = 2;

type Call = Direction;

/** Everything about a call that is worth reviewing afterwards. */
interface PracticeTrade {
  id: string;
  seq: number;
  symbol: string;
  timeframe: Timeframe;
  call: Call;
  /** Index into the driver series where the call was made. */
  atIndex: number;
  atTime: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  atr: number;
  /** True when the levels came from an ATR fallback, not an engine plan. */
  improvisedPlan: boolean;
  /** The engine's read at the moment of the call, frozen for review. */
  qualityScore: number | null;
  scannerState: string | null;
  engineDirection: Direction;
  /**
   * Stored as phrases rather than rendered text so the review history follows
   * the locale. Freezing the rendered string would pin a trade logged in Thai
   * to Thai forever, even after the user switches the app to English.
   */
  reasons: Phrase[];
  resolution: PracticeResolution | null;
}

interface Loaded {
  symbol: string;
  driver: Timeframe;
  candles: Partial<Record<Timeframe, Candle[]>>;
  status: DataStatus;
}

function tradeOutcome(trade: PracticeTrade): "win" | "loss" | "flat" | null {
  const r = trade.resolution;
  if (!r) return null;
  if (trade.call === "none") {
    // Standing aside is judged by whether the market actually went anywhere.
    return Math.abs(r.movePrice) < trade.atr * 0.5 ? "win" : "flat";
  }
  if (r.moveR === null) return r.movePrice > 0 ? "win" : "loss";
  if (Math.abs(r.moveR) < 0.1) return "flat";
  return r.moveR > 0 ? "win" : "loss";
}

/**
 * §46 market replay, §47-48 practice loop.
 *
 * The engine runs in the browser against the truncated slice the
 * ReplayController hands back, which is the whole point: the analysis the user
 * sees at candle N is computed from candles 0..N only, on every timeframe.
 *
 * Calls are settled like real trades — whichever of the stop and the target the
 * market reached first — and the full arithmetic is kept so the trader can
 * review entry, exit, excursion and R instead of a bare "correct".
 */
export default function TrainingPage() {
  const t = useT("trading");
  const tc = useT("common");
  const tj = useT("journal");
  const { locale } = useLocale();
  const { settings } = useSettings();

  const [symbol, setSymbol] = useState<string>(settings.watchlist[0] ?? "XAUUSD");
  const [driver, setDriver] = useState<Timeframe>("15m");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<ReplayController | null>(null);
  const [cursor, setCursor] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [trades, setTrades] = useState<PracticeTrade[]>([]);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlaying(false);
    try {
      const timeframes = Array.from(new Set<Timeframe>([...MTF_CHAIN, driver]));
      const responses = await Promise.all(
        timeframes.map(async (tf) => {
          const response = await fetch(
            `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=${LOAD_LIMIT}`,
          );
          const payload = (await response.json()) as {
            candles?: Candle[];
            status?: DataStatus;
            error?: string;
          };
          if (!response.ok || !payload.candles) throw new Error(payload.error ?? `failed on ${tf}`);
          return [tf, payload] as const;
        }),
      );

      const candles: Partial<Record<Timeframe, Candle[]>> = {};
      let status: DataStatus | null = null;
      for (const [tf, payload] of responses) {
        candles[tf] = payload.candles ?? [];
        if (tf === driver && payload.status) status = payload.status;
      }
      if (!status) throw new Error("no data status returned");

      const controller = new ReplayController(candles, driver, START_INDEX);
      controllerRef.current = controller;
      const state = controller.current;
      setCursor(state.cursor);
      setTotal(state.total);
      setLoaded({ symbol, driver, candles, status });
      setTrades([]);
      seqRef.current = 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
      setLoaded(null);
      controllerRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [symbol, driver]);

  /**
   * Settle any open call using only candles the replay clock has already
   * revealed. A trade that reaches its stop or target in three candles settles
   * in three candles; otherwise it waits for the measurement window to close.
   */
  const settleOpenTrades = useCallback(
    (nextCursor: number) => {
      const series = loaded?.candles[loaded.driver];
      if (!series) return;

      setTrades((prev) => {
        let changed = false;
        const next = prev.map((trade) => {
          if (trade.resolution !== null) return trade;
          const revealed = series.slice(trade.atIndex + 1, nextCursor + 1);
          if (revealed.length === 0) return trade;

          const resolution = resolvePracticeCall({
            direction: trade.call,
            entryPrice: trade.entryPrice,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            forward: revealed,
          });
          if (!resolution) return trade;

          const settled = resolution.kind !== "window_close" || revealed.length >= WINDOW;
          if (!settled) return trade;

          changed = true;
          return { ...trade, resolution };
        });
        return changed ? next : prev;
      });
    },
    [loaded],
  );

  const step = useCallback(
    (steps: number) => {
      const controller = controllerRef.current;
      if (!controller) return;
      const more = controller.step(steps);
      const state = controller.current;
      setCursor(state.cursor);
      settleOpenTrades(state.cursor);
      if (!more) setPlaying(false);
    },
    [settleOpenTrades],
  );

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => step(1), PLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, step]);

  const reset = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.reset(START_INDEX);
    setCursor(controller.current.cursor);
    setPlaying(false);
  }, []);

  // Re-run the engine on the revealed slice. `cursor` is in the dependency list
  // because it is what makes the slice move.
  const read = useMemo(() => {
    const controller = controllerRef.current;
    const asset: Asset | null = loaded ? getAsset(loaded.symbol) : null;
    if (!controller || !loaded || !asset) return null;
    const visible = controller.visible();
    const result = analyze({
      asset,
      candles: visible,
      entryTimeframe: loaded.driver,
      dataStatus: loaded.status,
      now: controller.currentTime,
    });
    return { result, visible, asset, clock: controller.currentTime };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, cursor]);

  const setup = read?.result.best ?? read?.result.setups[0] ?? null;
  const plan = setup ? primaryPlan(setup) : null;
  const atEnd = total > 0 && cursor >= total - 1;
  const openTrade = trades.find((trade) => trade.resolution === null) ?? null;

  const makeCall = useCallback(
    (call: Call) => {
      if (!read || !loaded) return;
      const price = read.result.price;
      const atr = read.result.atr || Math.abs(price) * 0.001;

      // Prefer the engine's own plan. When there is none, improvise a stop from
      // ATR so the call can still be measured — and say so on the card.
      let stopLoss: number | null = null;
      let takeProfit: number | null = null;
      let improvisedPlan = false;

      if (call !== "none") {
        const usable = plan && setup && setup.direction === call;
        if (usable && plan) {
          stopLoss = plan.stopLoss;
          takeProfit = plan.takeProfits[0]?.price ?? null;
        }
        if (stopLoss === null) {
          improvisedPlan = true;
          const risk = atr * FALLBACK_STOP_ATR;
          stopLoss = call === "long" ? price - risk : price + risk;
          takeProfit = call === "long" ? price + risk * FALLBACK_RR : price - risk * FALLBACK_RR;
        } else if (takeProfit === null) {
          const risk = Math.abs(price - stopLoss);
          takeProfit = call === "long" ? price + risk * FALLBACK_RR : price - risk * FALLBACK_RR;
        }
      }

      seqRef.current += 1;
      const trade: PracticeTrade = {
        id: `${loaded.symbol}-${cursor}-${seqRef.current}`,
        seq: seqRef.current,
        symbol: loaded.symbol,
        timeframe: loaded.driver,
        call,
        atIndex: cursor,
        atTime: read.clock,
        entryPrice: price,
        stopLoss,
        takeProfit,
        atr,
        improvisedPlan,
        qualityScore: setup?.quality.score ?? null,
        scannerState: setup?.scannerState ?? null,
        engineDirection: read.result.setups[0]?.direction ?? "none",
        reasons: (setup
          ? call === "none"
            ? setup.whyWait
            : setup.whyEnter.length > 0
              ? setup.whyEnter
              : setup.whyWait
          : read.result.noTradeReasons
        ).slice(0, 3),
        resolution: null,
      };
      setTrades((prev) => [...prev, trade]);
    },
    [read, loaded, plan, setup, cursor],
  );

  /* ---------------- session summary, computed from real R ---------------- */
  const summary = useMemo(() => {
    const resolved = trades.filter((tr) => tr.resolution !== null);
    const directional = resolved.filter((tr) => tr.call !== "none" && tr.resolution?.moveR != null);
    const rs = directional.map((tr) => tr.resolution?.moveR ?? 0);
    const wins = directional.filter((tr) => (tr.resolution?.moveR ?? 0) > 0).length;
    const targets = directional.filter((tr) => tr.resolution?.kind === "take_profit").length;
    const totalR = rs.reduce((sum, r) => sum + r, 0);
    return {
      calls: trades.length,
      resolved: resolved.length,
      pending: trades.length - resolved.length,
      wins,
      losses: directional.length - wins,
      totalR: directional.length > 0 ? totalR : null,
      avgR: directional.length > 0 ? totalR / directional.length : null,
      bestR: rs.length > 0 ? Math.max(...rs) : null,
      worstR: rs.length > 0 ? Math.min(...rs) : null,
      hitRate: directional.length > 0 ? (targets / directional.length) * 100 : null,
      sample: directional.length,
    };
  }, [trades]);

  const asset = read?.asset ?? null;
  const ordered = useMemo(() => [...trades].reverse(), [trades]);

  return (
    <>
      <TopBar title={t("replay.title")} />

      <main className="space-y-4 p-4">
        <SectionTitle title={t("replay.title")} subtitle={t("replay.subtitle")} />

        {/* ---------- pick a replay ---------- */}
        <section className="card p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("replay.market")}
              </span>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
              >
                {settings.watchlist.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("replay.driver")}
              </span>
              <select
                value={driver}
                onChange={(e) => setDriver(e.target.value as Timeframe)}
                className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
              >
                {DRIVERS.map((tf) => (
                  <option key={tf} value={tf}>
                    {timeframeLabel(tf)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="tap mt-3 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[13px] font-semibold disabled:opacity-50"
          >
            {loading ? t("replay.loading") : loaded ? t("replay.reload") : t("replay.load")}
          </button>

          {error ? (
            <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] text-[var(--color-short)]">
              {tc("state.error")}: {error}
            </p>
          ) : null}

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {t("replay.noFuture")}
          </p>
        </section>

        {read && loaded ? (
          <>
            {/* ---------- transport ---------- */}
            <section className="card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold tracking-tight">
                    {loaded.symbol}{" "}
                    <span className="text-[11.5px] font-normal text-[var(--color-faint)]">
                      {timeframeLabel(loaded.driver)}
                    </span>
                  </p>
                  <p className="num mt-0.5 text-[11.5px] text-[var(--color-muted)]">
                    {t("replay.clock")}: {formatTime(read.clock, locale)}
                  </p>
                </div>
                <DataStatusBadge status={loaded.status} compact />
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  disabled={atEnd}
                  className={cx(
                    "tap rounded-lg border text-[12px] font-medium disabled:opacity-50",
                    playing
                      ? "border-[var(--color-wait)]/50 bg-[var(--color-wait-soft)] text-[var(--color-wait)]"
                      : "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]",
                  )}
                >
                  <span aria-hidden className="mr-1">
                    {playing ? "❙❙" : "▶"}
                  </span>
                  {playing ? t("replay.pause") : t("replay.play")}
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={atEnd}
                  className="tap rounded-lg border border-[var(--color-border)] text-[12px] font-medium disabled:opacity-50"
                >
                  <span aria-hidden className="mr-1">
                    ›
                  </span>
                  {t("replay.next")}
                </button>
                <button
                  type="button"
                  onClick={() => step(10)}
                  disabled={atEnd}
                  className="tap rounded-lg border border-[var(--color-border)] text-[12px] font-medium disabled:opacity-50"
                >
                  <span aria-hidden className="mr-1">
                    »
                  </span>
                  {t("replay.forward")}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="tap rounded-lg border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-muted)]"
                >
                  <span aria-hidden className="mr-1">
                    ↺
                  </span>
                  {t("replay.reset")}
                </button>
              </div>

              <p className="num mt-2.5 text-[11.5px] text-[var(--color-faint)]">
                {t("replay.position")} {cursor + 1} / {total}
              </p>
              {atEnd ? (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-wait)]">
                  {t("replay.end")}
                </p>
              ) : null}

              <div className="mt-3">
                <PriceChart
                  candles={(read.visible[loaded.driver] ?? []).slice(-220)}
                  zones={read.result.zones}
                  structure={
                    read.result.structures.find((s) => s.timeframe === loaded.driver) ?? null
                  }
                  setup={setup}
                  plan={plan}
                  layers={settings.chartLayers}
                  minTick={read.asset.minTick}
                />
              </div>
            </section>

            {/* ---------- your call, made before the reveal ---------- */}
            <section className="card p-4">
              <SectionTitle title={t("replay.yourCall")} hint={t("replay.callHint")} />

              <div className="grid grid-cols-3 gap-1.5">
                {(["long", "short", "none"] as const).map((call) => {
                  const visual = directionVisual(call);
                  return (
                    <button
                      key={call}
                      type="button"
                      disabled={openTrade !== null || atEnd}
                      onClick={() => makeCall(call)}
                      className={cx(
                        "tap rounded-lg border text-[12.5px] font-medium disabled:opacity-40",
                        openTrade?.call === call
                          ? cx(visual.border, visual.bg, visual.text)
                          : "border-[var(--color-border)] text-[var(--color-muted)]",
                      )}
                    >
                      <span aria-hidden className="mr-1">
                        {visual.glyph}
                      </span>
                      {call === "none" ? t("replay.callNoTrade") : t(`direction.${call}`)}
                    </button>
                  );
                })}
              </div>

              {/* The live ticket: price in, levels, and how far it has gone so far. */}
              {openTrade ? (
                <div className="mt-3 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] p-3">
                  <p className="text-[11.5px] leading-relaxed text-[var(--color-wait)]">
                    {t("replay.callRecorded")}
                  </p>
                  <div className="mt-2 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                    <Row
                      label={t("replay.log.entry")}
                      value={`${formatPrice(openTrade.entryPrice, asset)}  ·  ${t("replay.log.atCandle")} ${openTrade.atIndex + 1}`}
                    />
                    {openTrade.stopLoss !== null ? (
                      <Row
                        label={t("replay.log.stop")}
                        value={formatPrice(openTrade.stopLoss, asset)}
                        tone="text-[var(--color-short)]"
                      />
                    ) : null}
                    {openTrade.takeProfit !== null ? (
                      <Row
                        label={t("replay.log.target")}
                        value={formatPrice(openTrade.takeProfit, asset)}
                        tone="text-[var(--color-long)]"
                      />
                    ) : null}
                    <Row
                      label={t("replay.window")}
                      value={`${WINDOW} ${t("replay.log.bars")}`}
                    />
                  </div>
                  {openTrade.improvisedPlan ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                      {t("replay.log.noEnginePlan")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* ---------- session summary ---------- */}
              <div className="mt-3.5 border-t border-[var(--color-border)] pt-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                  {t("replay.summary.title")}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label={t("replay.summary.calls")} value={summary.calls} />
                  <Stat label={t("replay.summary.resolved")} value={summary.resolved} />
                  <Stat label={t("replay.summary.pending")} value={summary.pending} />
                </div>
                <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                  <Row
                    label={t("replay.summary.totalR")}
                    value={formatR(summary.totalR)}
                    tone={
                      (summary.totalR ?? 0) > 0
                        ? "text-[var(--color-long)]"
                        : (summary.totalR ?? 0) < 0
                          ? "text-[var(--color-short)]"
                          : undefined
                    }
                  />
                  <Row label={t("replay.summary.avgR")} value={formatR(summary.avgR)} />
                  <Row
                    label={`${t("replay.summary.wins")} / ${t("replay.summary.losses")}`}
                    value={summary.sample > 0 ? `${summary.wins} / ${summary.losses}` : "—"}
                  />
                  <Row
                    label={t("replay.summary.hitRate")}
                    value={summary.hitRate === null ? "—" : formatPercent(summary.hitRate)}
                  />
                  <Row label={t("replay.summary.bestR")} value={formatR(summary.bestR)} />
                  <Row label={t("replay.summary.worstR")} value={formatR(summary.worstR)} />
                </div>
                {summary.sample > 0 && summary.sample < 10 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                    {t("replay.summary.notEnough")}
                  </p>
                ) : null}
                {trades.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTrades([])}
                    className="tap mt-2.5 w-full rounded-lg border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-muted)]"
                  >
                    {t("replay.summary.reset")}
                  </button>
                ) : null}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t("replay.practiceHint")}
              </p>
            </section>

            {/* ---------- the practice log: the actual numbers ---------- */}
            <section className="card p-4">
              <SectionTitle
                title={t("replay.log.title")}
                subtitle={t("replay.log.subtitle")}
                right={
                  <span className="num text-[11.5px] text-[var(--color-faint)]">
                    {trades.length}
                  </span>
                }
              />

              {ordered.length === 0 ? (
                <Empty title={t("replay.log.empty")} hint={t("replay.log.reviewHint")} />
              ) : (
                <ul className="space-y-2.5">
                  {ordered.map((trade) => {
                    const visual = directionVisual(trade.call);
                    const r = trade.resolution;
                    const outcome = tradeOutcome(trade);
                    const tone =
                      outcome === "win"
                        ? "text-[var(--color-long)]"
                        : outcome === "loss"
                          ? "text-[var(--color-short)]"
                          : "text-[var(--color-muted)]";

                    return (
                      <li
                        key={trade.id}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="num text-[11px] text-[var(--color-faint)]">
                              #{trade.seq}
                            </span>
                            <Badge
                              glyph={visual.glyph}
                              className={cx(visual.text, visual.bg, visual.border)}
                            >
                              {trade.call === "none"
                                ? t("replay.log.stayedOut")
                                : t(`direction.${trade.call}`)}
                            </Badge>
                            {trade.qualityScore !== null ? (
                              <Badge
                                className="border-[var(--color-border)] text-[var(--color-muted)]"
                                title={t("quality.notProbability")}
                              >
                                {t("quality.label")}{" "}
                                <span className="num">{trade.qualityScore}</span>
                              </Badge>
                            ) : null}
                          </div>
                          <span className={cx("num shrink-0 text-[14.5px] font-semibold", tone)}>
                            {r === null
                              ? t("replay.log.open")
                              : trade.call === "none"
                                ? formatPercent(r.movePercent)
                                : formatR(r.moveR)}
                          </span>
                        </div>

                        {/* the prices, which is the whole point of this screen */}
                        <div className="mt-2 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                          <Row
                            label={t("replay.log.entry")}
                            value={`${formatPrice(trade.entryPrice, asset)}  ·  ${formatTime(trade.atTime, locale)}`}
                          />
                          {trade.stopLoss !== null ? (
                            <Row
                              label={t("replay.log.stop")}
                              value={formatPrice(trade.stopLoss, asset)}
                              tone="text-[var(--color-short)]"
                            />
                          ) : null}
                          {trade.takeProfit !== null ? (
                            <Row
                              label={t("replay.log.target")}
                              value={formatPrice(trade.takeProfit, asset)}
                              tone="text-[var(--color-long)]"
                            />
                          ) : null}
                          {r !== null ? (
                            <>
                              <Row
                                label={t("replay.log.exit")}
                                value={`${formatPrice(r.exitPrice, asset)}  ·  ${formatTime(r.exitTime, locale)}`}
                              />
                              <Row
                                label={t("replay.log.move")}
                                value={`${r.movePrice >= 0 ? "+" : "−"}${formatPrice(Math.abs(r.movePrice), asset)}  (${formatPercent(r.movePercent, 2)})`}
                                tone={tone}
                              />
                              <Row
                                label={t("replay.log.held")}
                                value={`${r.barsHeld} ${t("replay.log.bars")}`}
                              />
                              <Row
                                label={`${t("replay.log.mfe")} / ${t("replay.log.mae")}`}
                                value={
                                  r.mfeR !== null && r.maeR !== null
                                    ? `${formatR(r.mfeR)} / ${formatR(r.maeR)}`
                                    : `${formatPrice(r.mfePrice, asset)} / ${formatPrice(r.maePrice, asset)}`
                                }
                              />
                              <Row
                                label={t("replay.log.result")}
                                value={
                                  r.kind === "take_profit"
                                    ? t("replay.log.hitTarget")
                                    : r.kind === "stop_loss"
                                      ? t("replay.log.hitStop")
                                      : t("replay.log.windowClose")
                                }
                                tone={tone}
                              />
                            </>
                          ) : null}
                        </div>

                        {/* honesty notes */}
                        {r?.ambiguous ? (
                          <p className="mt-2 rounded border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--color-wait)]">
                            {t("replay.log.ambiguous")}
                          </p>
                        ) : null}
                        {trade.improvisedPlan ? (
                          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                            {t("replay.log.noEnginePlan")}
                          </p>
                        ) : null}
                        {trade.call === "none" && r !== null ? (
                          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
                            {r.movePrice >= 0 ? t("replay.log.priceRose") : t("replay.log.priceFell")}{" "}
                            {formatPrice(Math.abs(r.movePrice), asset)} ·{" "}
                            {outcome === "win"
                              ? t("replay.log.stayedOutGood")
                              : t("replay.log.stayedOutMissed")}
                          </p>
                        ) : null}

                        {/* what the engine was saying at the moment of the call */}
                        {trade.reasons.length > 0 ? (
                          <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
                            <p className="mb-1.5 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                              {t("replay.log.engineAtCall")}
                              {trade.scannerState ? ` · ${t(`scannerState.${trade.scannerState}`)}` : ""}
                            </p>
                            <Bullets items={trade.reasons} glyph="·" />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ---------- what the engine sees on the revealed data only ---------- */}
            <section className="card p-4">
              <SectionTitle title={t("replay.engineRead")} />

              <div className="mb-3 flex flex-wrap gap-1.5">
                {setup ? (
                  <Badge
                    glyph={SCANNER_VISUAL[setup.scannerState].glyph}
                    className={cx(
                      SCANNER_VISUAL[setup.scannerState].text,
                      SCANNER_VISUAL[setup.scannerState].bg,
                      SCANNER_VISUAL[setup.scannerState].border,
                    )}
                  >
                    {t(`scannerState.${setup.scannerState}`)}
                  </Badge>
                ) : (
                  <Badge glyph="✕" className="border-[var(--color-border)] text-[var(--color-faint)]">
                    {t("noTrade.title")}
                  </Badge>
                )}
                <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
                  {t(`regime.${read.result.regime}`)}
                </Badge>
                {setup ? (
                  <Badge
                    className="border-[var(--color-border)] text-[var(--color-muted)]"
                    title={t("quality.notProbability")}
                  >
                    {t("quality.label")} <span className="num">{setup.quality.score}</span>
                  </Badge>
                ) : null}
              </div>

              <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                <Row
                  label={t("markets.price")}
                  value={formatPrice(read.result.price, read.asset)}
                />
                {plan ? (
                  <>
                    <Row
                      label={t("plan.stopLoss")}
                      value={formatPrice(plan.stopLoss, read.asset)}
                      tone="text-[var(--color-short)]"
                    />
                    {plan.takeProfits[0] ? (
                      <Row
                        label={tj("form.exit")}
                        value={formatPrice(plan.takeProfits[0].price, read.asset)}
                        tone="text-[var(--color-long)]"
                      />
                    ) : null}
                  </>
                ) : null}
                {read.result.structures.map((s) => (
                  <Row
                    key={s.timeframe}
                    label={timeframeLabel(s.timeframe)}
                    value={`${t(`trend.${s.trend}`)} · ${t(`phase.${s.phase}`)}`}
                  />
                ))}
                <Row label={t("mtf.agreement")} value={`${read.result.mtf.agreement}/100`} />
                <Row
                  label={t("pullback.label")}
                  value={t(`pullback.${read.result.pullback.verdict}`)}
                />
              </div>

              {setup ? (
                <div className="mt-3 space-y-3">
                  {setup.whyWait.length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("explain.whyWait")}
                      </p>
                      <Bullets items={setup.whyWait} glyph="!" tone="text-[var(--color-wait)]" />
                    </div>
                  ) : null}
                  {setup.whyEnter.length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("explain.whyEnter")}
                      </p>
                      <Bullets items={setup.whyEnter} glyph="+" tone="text-[var(--color-long)]" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                    {t("noTrade.reasons")}
                  </p>
                  <Bullets items={read.result.noTradeReasons} glyph="✕" empty={tc("state.empty")} />
                </div>
              )}
            </section>
          </>
        ) : null}

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
