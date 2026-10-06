"use client";

import { useMemo, useState } from "react";
import { summarizePerformance } from "@atc/engine";
import { DEFAULT_WATCHLIST, getAsset } from "@atc/market-data";
import type { TradeClassification } from "@atc/types";

import { JournalForm } from "@/components/JournalForm";
import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, Disclaimer, Empty, Row, SectionTitle, Stat, cx } from "@/components/ui";
import { directionVisual } from "@/components/visual";
import { useLocale, useT } from "@/i18n/provider";
import { formatNumber, formatPrice, formatR, formatTime, timeframeLabel } from "@/lib/format";
import { useJournal, useRules, type JournalEntry } from "@/lib/store";

/** Classifications that mean "the process was wrong", not just "the trade lost". */
const PROCESS_FAILURES: TradeClassification[] = [
  "bad_setup",
  "emotional_trade",
  "good_setup_bad_execution",
];

/**
 * §38-44: the journal, the performance numbers it produces, the missed-setup
 * and wrong-read sections, and the user's own rules.
 *
 * Everything here is computed from what the user actually logged. No metric is
 * invented, and when there is too little data we say so (metrics.notEnough)
 * instead of showing a meaningless 100% win rate.
 */
export default function JournalPage() {
  const t = useT("journal");
  const tt = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();

  const { entries, save, remove, loaded } = useJournal();
  const { rules, add: addRule, toggle: toggleRule, remove: removeRule } = useRules();

  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [ruleText, setRuleText] = useState("");

  const taken = useMemo(
    () => entries.filter((e) => e.classification !== "missed_trade"),
    [entries],
  );
  const missed = useMemo(
    () => entries.filter((e) => e.classification === "missed_trade"),
    [entries],
  );

  const perf = useMemo(() => summarizePerformance(taken), [taken]);

  // Plan adherence is only meaningful over entries where the user answered the
  // question, so unanswered entries are excluded rather than counted as "no".
  const adherence = useMemo(() => {
    const answered = taken.filter((e) => e.followedPlan !== null);
    if (answered.length === 0) return null;
    const followed = answered.filter((e) => e.followedPlan === true).length;
    return { followed, total: answered.length, percent: (followed / answered.length) * 100 };
  }, [taken]);

  const excursions = useMemo(() => {
    const withMfe = taken.filter((e) => e.mfeR !== null);
    const withMae = taken.filter((e) => e.maeR !== null);
    return {
      mfe:
        withMfe.length > 0
          ? withMfe.reduce((a, e) => a + (e.mfeR ?? 0), 0) / withMfe.length
          : null,
      mae:
        withMae.length > 0
          ? withMae.reduce((a, e) => a + (e.maeR ?? 0), 0) / withMae.length
          : null,
    };
  }, [taken]);

  const byClassification = useMemo(() => {
    const map = new Map<TradeClassification, { count: number; totalR: number }>();
    for (const e of entries) {
      if (!e.classification) continue;
      const row = map.get(e.classification) ?? { count: 0, totalR: 0 };
      row.count++;
      row.totalR += e.resultR ?? 0;
      map.set(e.classification, row);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [entries]);

  const bySymbol = useMemo(() => {
    const map = new Map<string, { count: number; totalR: number }>();
    for (const e of taken) {
      if (e.resultR === null) continue;
      const row = map.get(e.symbol) ?? { count: 0, totalR: 0 };
      row.count++;
      row.totalR += e.resultR;
      map.set(e.symbol, row);
    }
    return [...map.entries()].sort((a, b) => b[1].totalR - a[1].totalR);
  }, [taken]);

  const symbols = useMemo(() => {
    const fromEntries = entries.map((e) => e.symbol);
    return Array.from(new Set([...DEFAULT_WATCHLIST, ...fromEntries]));
  }, [entries]);

  const thin = perf.trades < 20;

  const onSave = (entry: JournalEntry) => {
    save(entry);
    setEditing(null);
    setAdding(false);
  };

  return (
    <>
      <TopBar title={t("title")} />

      <main className="space-y-4 p-4">
        <SectionTitle title={t("title")} subtitle={t("subtitle")} />

        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          <span className="font-medium text-[var(--color-muted)]">{t("storage.local")}</span>{" "}
          {t("storage.localHint")}
        </p>

        {adding || editing ? (
          <JournalForm
            symbols={symbols}
            initial={editing ?? undefined}
            onSave={onSave}
            onCancel={() => {
              setEditing(null);
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="tap w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[13px] font-semibold"
          >
            + {t("add")}
          </button>
        )}

        {/* ---------- performance ---------- */}
        <section className="card p-4">
          <SectionTitle
            title={t("metrics.title")}
            subtitle={thin ? t("metrics.notEnough") : undefined}
          />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t("metrics.trades")} value={perf.trades} />
            <Stat label={t("metrics.winRate")} value={`${formatNumber(perf.winRate, 1)}%`} />
            <Stat
              label={t("metrics.expectancy")}
              value={formatR(perf.trades > 0 ? perf.expectancyR : null)}
              tone={
                perf.expectancyR > 0
                  ? "text-[var(--color-long)]"
                  : perf.expectancyR < 0
                    ? "text-[var(--color-short)]"
                    : undefined
              }
            />
            <Stat
              label={t("metrics.totalR")}
              value={formatR(perf.trades > 0 ? perf.totalR : null)}
              tone={
                perf.totalR > 0
                  ? "text-[var(--color-long)]"
                  : perf.totalR < 0
                    ? "text-[var(--color-short)]"
                    : undefined
              }
            />
          </div>

          <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
            <Row
              label={t("metrics.profitFactor")}
              value={perf.trades > 0 ? formatNumber(perf.profitFactor, 2) : "—"}
            />
            <Row label={t("metrics.avgWin")} value={formatR(perf.wins > 0 ? perf.averageWinR : null)} />
            <Row
              label={t("metrics.avgLoss")}
              value={formatR(perf.losses > 0 ? perf.averageLossR : null)}
            />
            <Row
              label={t("metrics.maxDrawdown")}
              value={perf.trades > 0 ? `${formatNumber(perf.maxDrawdownR, 2)}R` : "—"}
            />
            <Row
              label={t("metrics.planAdherence")}
              value={
                adherence
                  ? `${formatNumber(adherence.percent, 0)}% (${adherence.followed}/${adherence.total})`
                  : "—"
              }
            />
          </div>
        </section>

        {/* ---------- MFE / MAE (§41) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("excursion.title")} hint={t("excursion.hint")} />
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label={t("excursion.mfe")}
              value={excursions.mfe !== null ? `${formatNumber(excursions.mfe, 2)}R` : "—"}
            />
            <Stat
              label={t("excursion.mae")}
              value={excursions.mae !== null ? `${formatNumber(excursions.mae, 2)}R` : "—"}
            />
          </div>
        </section>

        {/* ---------- classification split (§39) ---------- */}
        {byClassification.length > 0 ? (
          <section className="card p-4">
            <SectionTitle title={t("classification.label")} hint={t("classification.hint")} />
            <div className="divide-y divide-[var(--color-border)]">
              {byClassification.map(([key, row]) => (
                <div key={key} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium">{t(`classification.${key}`)}</p>
                    <p className="num text-[11px] text-[var(--color-faint)]">
                      {row.count} · {formatR(row.totalR)}
                    </p>
                  </div>
                  {PROCESS_FAILURES.includes(key) ? (
                    <Badge
                      glyph="!"
                      className="shrink-0 border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]"
                    >
                      {t("rules.violations")}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {bySymbol.length > 0 ? (
          <section className="card p-4">
            <SectionTitle title={t("metrics.bySymbol")} />
            <div className="divide-y divide-[var(--color-border)]">
              {bySymbol.map(([symbol, row]) => (
                <Row
                  key={symbol}
                  label={`${symbol} (${row.count})`}
                  value={formatR(row.totalR)}
                  tone={
                    row.totalR > 0
                      ? "text-[var(--color-long)]"
                      : row.totalR < 0
                        ? "text-[var(--color-short)]"
                        : undefined
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ---------- the entries ---------- */}
        <section className="space-y-2.5">
          <SectionTitle title={t("title")} right={<span className="num">{entries.length}</span>} />

          {!loaded ? (
            <p className="text-[12.5px] text-[var(--color-faint)]">{tc("state.loading")}</p>
          ) : entries.length === 0 ? (
            <Empty title={t("empty")} hint={t("storage.localHint")} />
          ) : (
            <ul className="space-y-2.5">
              {entries.map((entry) => {
                const asset = getAsset(entry.symbol);
                const dir = directionVisual(entry.direction);

                return (
                  <li key={entry.id} className="card p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="text-[14.5px] font-semibold tracking-tight">
                          {entry.symbol}
                        </span>
                        <span className="num shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-muted)]">
                          {timeframeLabel(entry.timeframe)}
                        </span>
                        <Badge glyph={dir.glyph} className={cx(dir.text, dir.bg, dir.border)}>
                          {tt(`direction.${entry.direction}`)}
                        </Badge>
                        {entry.followedPlan === false ? (
                          <Badge
                            glyph="!"
                            className="border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]"
                          >
                            {t("form.followedPlan")} ✕
                          </Badge>
                        ) : null}
                      </div>
                      <span
                        className={cx(
                          "num shrink-0 text-[14.5px] font-semibold",
                          (entry.resultR ?? 0) > 0
                            ? "text-[var(--color-long)]"
                            : (entry.resultR ?? 0) < 0
                              ? "text-[var(--color-short)]"
                              : "text-[var(--color-muted)]",
                        )}
                      >
                        {formatR(entry.resultR)}
                      </span>
                    </div>

                    {entry.classification ? (
                      <p className="mt-2 text-[12px] text-[var(--color-muted)]">
                        {t(`classification.${entry.classification}`)}
                      </p>
                    ) : null}

                    <div className="mt-2 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                      <Row label={t("form.entry")} value={formatPrice(entry.entryPrice, asset)} />
                      <Row
                        label={t("form.stop")}
                        value={formatPrice(entry.stopLoss, asset)}
                        tone="text-[var(--color-short)]"
                      />
                      {entry.exitPrice !== null ? (
                        <Row label={t("form.exit")} value={formatPrice(entry.exitPrice, asset)} />
                      ) : null}
                      <Row
                        label={t("form.openedAt")}
                        value={formatTime(entry.openedAt, locale)}
                      />
                    </div>

                    {entry.feeling ? (
                      <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">
                        {t("form.feeling")}: {entry.feeling}
                      </p>
                    ) : null}

                    {entry.notes ? (
                      <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                        <Bullets items={[entry.notes]} glyph="✎" />
                      </div>
                    ) : null}

                    {entry.setupId === null ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-wait)]">
                        {t("form.noSetupLink")}
                      </p>
                    ) : null}

                    <p className="mt-2 text-[10.5px] text-[var(--color-faint)]">
                      {t("originalLanguage", { lang: entry.language === "th" ? "ไทย" : "English" })}
                    </p>

                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setEditing(entry);
                        }}
                        className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
                      >
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-faint)]"
                      >
                        {tc("actions.delete")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------- missed setups (§42) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("missed.title")} subtitle={t("missed.subtitle")} />
          {missed.length === 0 ? (
            <p className="text-[12px] text-[var(--color-faint)]">{tc("state.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {missed.map((entry) => (
                <li key={entry.id} className="py-2">
                  <p className="text-[12.5px] font-medium">
                    {entry.symbol} · {timeframeLabel(entry.timeframe)}
                  </p>
                  {entry.notes ? (
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
                      {t("missed.whyMissed")}: {entry.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {t("missed.noHindsight")}
          </p>
        </section>

        {/* ---------- the user's own rules (§44) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("rules.title")} subtitle={t("rules.subtitle")} />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = ruleText.trim();
              if (!text) return;
              addRule(text);
              setRuleText("");
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder={t("rules.placeholder")}
              className="tap min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
            />
            <button
              type="submit"
              className="tap shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] px-4 text-[12.5px] font-semibold"
            >
              {t("rules.add")}
            </button>
          </form>

          {rules.length === 0 ? (
            <p className="mt-3 text-[12px] text-[var(--color-faint)]">{t("rules.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2 py-2">
                  <button
                    type="button"
                    aria-pressed={rule.active}
                    onClick={() => toggleRule(rule.id)}
                    className="shrink-0 text-[12px] text-[var(--color-muted)]"
                    title={rule.active ? t("rules.active") : t("rules.paused")}
                  >
                    <span aria-hidden>{rule.active ? "●" : "○"}</span>
                  </button>
                  <span
                    className={cx(
                      "min-w-0 flex-1 text-[12.5px] leading-snug",
                      rule.active ? "text-[var(--color-text)]" : "text-[var(--color-faint)] line-through",
                    )}
                  >
                    {rule.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    className="shrink-0 text-[11px] text-[var(--color-faint)]"
                  >
                    {tc("actions.delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
