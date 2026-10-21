"use client";

import { useCallback, useRef, useState } from "react";
import { SKIP_REASONS, type SkipReason } from "@atc/engine";
import type { Timeframe } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import {
  BACKTEST_DEPTH_DAYS,
  BACKTEST_MODES,
  BACKTEST_TIMEFRAMES,
  DEFAULT_BACKTEST_MODE,
  DEFAULT_BACKTEST_TIMEFRAME,
  backfillIncomplete,
  backtestVerdict,
  hasUsableSample,
  type BackfillResponse,
  type BacktestMode,
  type BacktestResponse,
  type BacktestVerdict,
} from "@/lib/backtest";
import { formatPercent, formatR, formatTime, timeframeLabel } from "@/lib/format";
import { useSettings } from "@/lib/store";
import { Row, SectionTitle, Stat, cx } from "./ui";

/**
 * The screen that grades the grader.
 *
 * Every other surface in this app presents a setup's letter as if it meant
 * something. Nothing checked that it did. This panel runs the engine back over
 * the history already in memory, settles its own signals against what the
 * market then did, and reports average R per grade — so "A" either earns its
 * place or is revealed as decoration.
 *
 * The hard part is not the arithmetic, it is refusing to overclaim. On the
 * few hundred bars a free feed holds, no grade reaches a sample size where
 * expectancy means anything, so the honest headline is almost always "cannot
 * say yet". A panel that rendered that as a tick, or as a cross, would be
 * worse than no panel: it would attach a verdict to the one number the whole
 * app leans on, on the strength of nine trades. `backtestVerdict` keeps the
 * five outcomes apart and this renders all five differently.
 */

const VERDICT_TONE: Record<BacktestVerdict, { border: string; text: string; glyph: string }> = {
  holds: { border: "border-[var(--color-long)]/40 bg-[var(--color-long-soft)]", text: "text-[var(--color-long)]", glyph: "✓" },
  inverted: { border: "border-[var(--color-short)]/40 bg-[var(--color-short-soft)]", text: "text-[var(--color-short)]", glyph: "✕" },
  thin: { border: "border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)]", text: "text-[var(--color-wait)]", glyph: "?" },
  noSignals: { border: "border-[var(--color-border-strong)]", text: "text-[var(--color-muted)]", glyph: "○" },
  noRun: { border: "border-[var(--color-short)]/40 bg-[var(--color-short-soft)]", text: "text-[var(--color-short)]", glyph: "!" },
};

export function BacktestPanel() {
  const t = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();
  const { settings } = useSettings();

  const [symbol, setSymbol] = useState(settings.watchlist[0] ?? "XAUUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_BACKTEST_TIMEFRAME);
  const [mode, setMode] = useState<BacktestMode>(DEFAULT_BACKTEST_MODE);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BacktestResponse | null>(null);

  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fill, setFill] = useState<BackfillResponse | null>(null);

  // A result graded on the archive as it was *before* a backfill. The numbers
  // are still real, but they no longer describe the history the panel is now
  // claiming to hold, and the two sat side by side read as one statement.
  const [stale, setStale] = useState(false);

  // The run takes seconds. Without this, pressing twice leaves two requests in
  // flight and the slower one wins, so the table ends up showing the settings
  // the user abandoned rather than the ones they chose.
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = runId.current + 1;
    runId.current = id;
    setRunning(true);
    setError(null);

    try {
      const query = new URLSearchParams({ symbol, timeframe, mode });
      const response = await fetch(`/api/backtest?${query}`);
      const payload = (await response.json()) as BacktestResponse | { error: string };
      if (runId.current !== id) return;

      if (!response.ok || "error" in payload) {
        setError("error" in payload ? payload.error : tc("state.error"));
        setData(null);
        return;
      }
      setData(payload);
      setStale(false);
      // The fresh run carries its own coverage, measured after the fill. The
      // backfill's own frame list has served its purpose and keeping it would
      // leave per-frame page counts on screen that belong to an earlier press.
      setFill(null);
    } catch {
      if (runId.current === id) {
        setError(tc("state.error"));
        setData(null);
      }
    } finally {
      if (runId.current === id) setRunning(false);
    }
  }, [symbol, timeframe, mode, tc]);

  /**
   * Buy history and write it down. Separate from `run` on purpose: this is the
   * press that spends, and folding it into the backtest button would have a
   * free action silently start costing credits the first time it was used on
   * gold.
   */
  const deepen = useCallback(async () => {
    setFilling(true);
    setFillError(null);
    try {
      const query = new URLSearchParams({ symbol, timeframe, mode });
      const response = await fetch(`/api/backtest/backfill?${query}`, { method: "POST" });
      const payload = (await response.json()) as BackfillResponse | { error: string };
      if (!response.ok || "error" in payload) {
        setFillError("error" in payload ? payload.error : tc("state.error"));
        return;
      }
      setFill(payload);
      // Only a result already on screen can go stale. Marking it regardless
      // would put a "re-run me" prompt above an empty panel.
      setStale(data !== null);
    } catch {
      setFillError(tc("state.error"));
    } finally {
      setFilling(false);
    }
  }, [symbol, timeframe, mode, tc, data]);

  const report = data?.report ?? null;
  const verdict = report ? backtestVerdict(report) : null;
  const tone = verdict ? VERDICT_TONE[verdict] : null;
  const usable = report ? hasUsableSample(report) : false;

  /**
   * Keep a response only while the controls still point at what produced it.
   *
   * The results table is allowed to outlive a control change because `ranOn`
   * names the market it describes. Coverage is not: it is a claim about the
   * *current* selection that drives a spending button, so 120 days carried
   * over from gold onto a market with nothing stored would read as "already
   * filled" and quietly hand the user a shallow backtest. Mode is not part of
   * the test — the archive is per symbol and timeframe, and clearing on a mode
   * flip would discard a true statement.
   */
  const forCurrent = <T extends { request: { symbol: string; timeframe: Timeframe } }>(
    response: T | null,
  ): T | null =>
    response && response.request.symbol === symbol && response.request.timeframe === timeframe
      ? response
      : null;

  const shownFill = forCurrent(fill);
  const coverage = shownFill?.coverage ?? forCurrent(data)?.coverage ?? null;
  const busy = running || filling;

  return (
    <section className="card p-4">
      <SectionTitle title={t("backtest.title")} subtitle={t("backtest.subtitle")} />

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("backtest.market")}
          </span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
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
            {t("backtest.timeframe")}
          </span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
          >
            {BACKTEST_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {timeframeLabel(tf)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("backtest.mode")}
          </span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as BacktestMode)}
            className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
          >
            {BACKTEST_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`backtest.modes.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
        {t(`backtest.modeHint.${mode}`)}
      </p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="tap mt-3 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[13px] font-semibold disabled:opacity-50"
      >
        {running ? t("backtest.running") : data ? t("backtest.rerun") : t("backtest.run")}
      </button>

      {/* The run is CPU-bound and takes a few seconds. Saying so up front is
          the difference between "working" and "broken" on a slow phone. */}
      {running ? (
        <p className="mt-2 text-center text-[11px] text-[var(--color-faint)]">{t("backtest.runningHint")}</p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] text-[var(--color-short)]">
          {error}
        </p>
      ) : null}

      {/* ---------- how deep the history is, and how to make it deeper ------
          Drawn only once a response has said what is stored. A "deepen"
          button offered before anything is known is a press that may spend
          credits to buy bars the archive already holds. */}
      {coverage ? (
        <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("backtest.depth.title")}
            </span>
            <span className="num text-[12.5px] font-semibold tabular-nums">
              {coverage.configured
                ? t("backtest.depth.stored", {
                    days: coverage.days,
                    bars: coverage.bars.toLocaleString(locale),
                  })
                : t("backtest.depth.none")}
            </span>
          </div>

          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {!coverage.configured
              ? t("backtest.depth.unconfigured")
              : data?.source === "live"
                ? t("backtest.depth.liveHint", { days: BACKTEST_DEPTH_DAYS })
                : t("backtest.depth.archiveHint")}
          </p>

          {coverage.configured ? (
            <button
              type="button"
              onClick={() => void deepen()}
              disabled={busy}
              className="tap mt-2 w-full rounded-lg border border-[var(--color-border-strong)] text-[12.5px] font-semibold disabled:opacity-50"
            >
              {filling
                ? t("backtest.depth.filling")
                : t("backtest.depth.fill", { days: BACKTEST_DEPTH_DAYS })}
            </button>
          ) : null}

          {/* The slow path is the metered one, where the press spends most of
              its time waiting on an 8-per-minute limiter rather than working.
              Without this the button looks hung. */}
          {filling ? (
            <p className="mt-1.5 text-center text-[11px] text-[var(--color-faint)]">
              {t("backtest.depth.fillingHint")}
            </p>
          ) : null}

          {fillError ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-short)]">{fillError}</p>
          ) : null}

          {/* Per frame, never collapsed. A run where 5M alone stopped early is
              a real outcome the user fixes by pressing again, and a single
              success flag would hide it. */}
          {shownFill ? (
            <div className="mt-2 border-t border-[var(--color-border)] pt-1.5">
              {shownFill.frames.map((frame) => (
                <Row
                  key={frame.timeframe}
                  label={timeframeLabel(frame.timeframe)}
                  value={t(`backtest.depth.stopped.${frame.stopped}`, {
                    bars: frame.stored.toLocaleString(locale),
                  })}
                  tone={
                    frame.stopped === "error"
                      ? "text-[var(--color-short)]"
                      : frame.stopped === "target"
                        ? "text-[var(--color-long)]"
                        : "text-[var(--color-wait)]"
                  }
                />
              ))}
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t("backtest.depth.fillFooter", {
                  seconds: (shownFill.ranMs / 1000).toFixed(1),
                  credits: shownFill.credits ?? 0,
                })}
                {backfillIncomplete(shownFill.frames) ? ` ${t("backtest.depth.pressAgain")}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* A result graded before the archive was deepened. Shown between the
          depth block and the table because that is the reading order in which
          the two would otherwise be taken as one statement. */}
      {stale && forCurrent(data) ? (
        <p className="mt-3 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-wait)]">
          {t("backtest.depth.stale")}
        </p>
      ) : null}

      {data && report && verdict && tone ? (
        <div className="mt-4 space-y-4">
          {/* What the *server* ran, never what the controls currently say. The
              run takes seconds, which is long enough to change the mode while
              it is in flight and then read one mode's numbers under the
              other's heading — and `entry` finding nothing where `graded`
              found seventeen trades is exactly the pair that misleads. Drawn
              above the verdict because that is the first line read. */}
          <p className="text-[11px] tracking-wide text-[var(--color-faint)]">
            {t("backtest.ranOn", {
              market: data.request.symbol,
              timeframe: timeframeLabel(data.request.timeframe),
              mode: t(`backtest.modes.${data.request.mode}`),
            })}
          </p>

          {/* ---------- the verdict ---------- */}
          <div className={cx("rounded-xl border px-3 py-2.5", tone.border)}>
            <p className={cx("flex items-center gap-1.5 text-[12.5px] font-semibold", tone.text)}>
              <span aria-hidden>{tone.glyph}</span>
              {t(`backtest.verdict.${verdict}`)}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
              {t(`backtest.verdictHint.${verdict}`)}
            </p>
            {/* "Not enough trades" means two different things and the panel
                must not let them blur. On the live window it is a statement
                about the *window* and the remedy is to store history; on four
                months of archive the history is already there and the sample
                is what the strategy produced, which is a statement about the
                strategy. Same verdict, opposite conclusions. */}
            {verdict === "thin" ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t(`backtest.thinBecause.${data.source}`, { days: data.coverage.days })}
              </p>
            ) : null}
          </div>

          {/* ---------- what the run covered ---------- */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("backtest.stats.analysed")} value={report.analysed} />
            <Stat label={t("backtest.stats.signals")} value={report.signals} />
            <Stat label={t("backtest.stats.trades")} value={report.overall.trades} />
            <Stat
              label={t("backtest.stats.expectancy")}
              // Withheld below the sample size at which an average can still
              // flip sign on one outlier. A figure to two decimals reads as a
              // measured edge no matter how few trades produced it.
              value={
                report.overall.trades === 0
                  ? "—"
                  : usable
                    ? formatR(report.overall.expectancyR)
                    : t("backtest.stats.tooFew")
              }
              tone={
                usable
                  ? report.overall.expectancyR >= 0
                    ? "text-[var(--color-long)]"
                    : "text-[var(--color-short)]"
                  : "text-[var(--color-faint)]"
              }
            />
          </div>

          {/* Coverage is worth stating even on an empty run — it is the proof
              that the engine looked, and over what. The result rows are not:
              with nothing settled they are a wall of zeros and four dashes,
              which reads as a broken table rather than as an empty one. */}
          <div className="rounded-lg border border-[var(--color-border)] px-3 py-1">
            <Row
              label={t("backtest.stats.coverage")}
              value={`${formatTime(report.from, locale)} – ${formatTime(report.to, locale)}`}
            />
            {report.overall.trades > 0 ? (
              <>
                <Row
                  label={t("backtest.stats.settled")}
                  value={`${report.overall.wins}W / ${report.overall.losses}L · ${formatPercent(report.overall.winRate)}`}
                />
                <Row label={t("backtest.stats.totalR")} value={formatR(report.overall.totalR)} />
                <Row
                  label={t("backtest.stats.maxDd")}
                  value={formatR(-report.overall.maxDrawdownR)}
                  tone="text-[var(--color-short)]"
                />
              </>
            ) : null}
          </div>

          {/* ---------- the question itself ---------- */}
          {report.overall.trades > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("backtest.byGrade")}
            </p>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                <span>{t("backtest.grade")}</span>
                <span className="text-right">{t("backtest.stats.trades")}</span>
                <span className="text-right">{t("backtest.stats.winRate")}</span>
                <span className="text-right">{t("backtest.stats.avgR")}</span>
              </div>
              {report.byGrade.map((g) => {
                const empty = g.summary.trades === 0;
                return (
                  <div
                    key={g.grade}
                    className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 border-b border-[var(--color-border)] px-2.5 py-1.5 text-[12px] last:border-b-0"
                  >
                    <span className="font-semibold">{g.grade}</span>
                    <span className="num text-right tabular-nums">{g.summary.trades}</span>
                    <span className="num text-right tabular-nums text-[var(--color-muted)]">
                      {empty ? "—" : formatPercent(g.summary.winRate)}
                    </span>
                    <span
                      className={cx(
                        "num text-right font-medium tabular-nums",
                        empty
                          ? "text-[var(--color-faint)]"
                          : g.summary.expectancyR >= 0
                            ? "text-[var(--color-long)]"
                            : "text-[var(--color-short)]",
                      )}
                    >
                      {empty ? "—" : formatR(g.summary.expectancyR)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Two qualifiers that change how the column above should be read:
                a tie resolved against us, and a trade that never resolved. */}
            {report.byGrade.some((g) => g.ambiguous > 0 || g.windowClosed > 0) ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t("backtest.qualifiers", {
                  ambiguous: report.byGrade.reduce((n, g) => n + g.ambiguous, 0),
                  windowClosed: report.byGrade.reduce((n, g) => n + g.windowClosed, 0),
                })}
              </p>
            ) : null}
          </div>
          ) : null}

          {/* ---------- why so few trades ---------- */}
          {SKIP_REASONS.some((r) => report.skipped[r] > 0) ? (
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("backtest.skipped")}
              </p>
              <div className="rounded-lg border border-[var(--color-border)] px-3 py-1">
                {SKIP_REASONS.filter((r) => report.skipped[r] > 0).map((reason: SkipReason) => (
                  <Row key={reason} label={t(`backtest.skip.${reason}`)} value={report.skipped[reason]} />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t("backtest.skippedHint")}
              </p>
            </div>
          ) : null}

          {/* ---------- what this run cost and what it cannot tell you ------- */}
          <div className="border-t border-[var(--color-border)] pt-2">
            <p className="num text-[11px] tabular-nums text-[var(--color-faint)]">
              {t("backtest.footer", {
                bars: (data.bars[data.request.timeframe] ?? 0).toLocaleString(locale),
                stride: data.stride,
                seconds: (data.ranMs / 1000).toFixed(1),
                credits: data.credits ?? 0,
              })}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
              {t("backtest.caveat")}
            </p>
            {/* The stride is not an implementation detail once it is wide.
                ENTRY_NOW is momentary by construction, so a four-hour step
                walks over most of the moments it existed — and `entry` mode
                reporting one trade over four months is then partly an artefact
                of the sampling rather than a fact about the market. Said only
                where it bites. */}
            {data.request.mode === "entry" && data.stride > 4 ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t("backtest.strideCaveat", { stride: data.stride })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
