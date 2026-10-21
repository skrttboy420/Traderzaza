"use client";

import { useCallback, useRef, useState } from "react";
import { SKIP_REASONS, type SkipReason } from "@atc/engine";
import type { Timeframe } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import {
  BACKTEST_MODES,
  BACKTEST_TIMEFRAMES,
  DEFAULT_BACKTEST_MODE,
  DEFAULT_BACKTEST_TIMEFRAME,
  backtestVerdict,
  hasUsableSample,
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
    } catch {
      if (runId.current === id) {
        setError(tc("state.error"));
        setData(null);
      }
    } finally {
      if (runId.current === id) setRunning(false);
    }
  }, [symbol, timeframe, mode, tc]);

  const report = data?.report ?? null;
  const verdict = report ? backtestVerdict(report) : null;
  const tone = verdict ? VERDICT_TONE[verdict] : null;
  const usable = report ? hasUsableSample(report) : false;

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
        disabled={running}
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
                bars: data.bars[data.request.timeframe] ?? 0,
                seconds: (data.ranMs / 1000).toFixed(1),
                credits: data.credits ?? 0,
              })}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
              {t("backtest.caveat")}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
