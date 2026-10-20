"use client";

import { useMemo } from "react";
import { dailyGuard, type DailyGuard } from "@atc/engine";

import { useT, usePhrase } from "@/i18n/provider";
import { useJournal, useSettings } from "@/lib/store";
import { cx } from "./ui";

/**
 * The daily circuit breaker, shown where the next trade would be taken.
 *
 * Everything it needs lives in the browser — the journal and the limits are
 * both localStorage — so this is computed client-side and the server scan knows
 * nothing about it. That is the right split anyway: the limits are personal and
 * the scan is not.
 *
 * `dayStart` is the browser's local midnight. A trader's day is the one on
 * their wall, not UTC's, and getting this wrong in either direction is
 * expensive: too early and yesterday's damage closes today, too late and the
 * breaker never resets.
 */
function localMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

const TONE: Record<DailyGuard["state"], { border: string; bg: string; text: string; glyph: string }> =
  {
    stop: {
      border: "border-[var(--color-short)]/50",
      bg: "bg-[var(--color-short-soft)]",
      text: "text-[var(--color-short)]",
      glyph: "⛔",
    },
    caution: {
      border: "border-[var(--color-wait)]/45",
      bg: "bg-[var(--color-wait-soft)]",
      text: "text-[var(--color-wait)]",
      glyph: "⚠",
    },
    clear: {
      border: "border-[var(--color-border)]",
      bg: "bg-[var(--color-surface-2)]",
      text: "text-[var(--color-muted)]",
      glyph: "◎",
    },
  };

export function DailyGuardBanner({ className }: { className?: string }) {
  const t = useT("trading");
  const say = usePhrase();
  const { settings, loaded: settingsLoaded } = useSettings();
  const { entries, loaded: journalLoaded } = useJournal();

  const guard = useMemo(
    () =>
      dailyGuard({
        trades: entries,
        dayStart: localMidnight(),
        limits: {
          maxDailyLossR: settings.maxDailyLossR,
          maxTradesPerDay: settings.maxTradesPerDay,
          maxOpenPositions: settings.maxOpenPositions,
        },
      }),
    [entries, settings.maxDailyLossR, settings.maxTradesPerDay, settings.maxOpenPositions],
  );

  // Both stores hydrate after mount. Rendering before then would briefly show
  // the empty-journal verdict — "no trades today, you are clear" — to a trader
  // who is three stops down, which is precisely the moment to be silent rather
  // than wrong.
  if (!settingsLoaded || !journalLoaded) return null;
  if (guard.reasons.length === 0) return null;

  const tone = TONE[guard.state];
  const heading =
    guard.state === "stop"
      ? t("guard.stopTitle")
      : guard.state === "caution"
        ? t("guard.cautionTitle")
        : t("guard.clearTitle");

  return (
    <section
      role={guard.state === "stop" ? "alert" : undefined}
      className={cx("rounded-xl border p-3.5", tone.border, tone.bg, className)}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cx("mt-px shrink-0 text-[13px] leading-none", tone.text)}>
          {tone.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cx("text-[12.5px] font-semibold", tone.text)}>{heading}</h2>

          <ul className="mt-1.5 space-y-1.5">
            {guard.reasons.map((reason) => (
              <li key={reason.key} className="text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
                {say(reason)}
              </li>
            ))}
          </ul>

          {/* The raw counts, so the sentence above can be checked rather than
              believed. A breaker the trader cannot audit is one they will
              override the first time they suspect it is wrong. */}
          <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-faint)]">
            <div className="flex gap-1.5">
              <dt>{t("guard.netR")}</dt>
              <dd
                className={cx(
                  "num font-medium",
                  guard.netR > 0
                    ? "text-[var(--color-long)]"
                    : guard.netR < 0
                      ? "text-[var(--color-short)]"
                      : "text-[var(--color-muted)]",
                )}
              >
                {guard.netR > 0 ? "+" : ""}
                {guard.netR}R
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{t("guard.tradesToday")}</dt>
              <dd className="num font-medium text-[var(--color-muted)]">
                {guard.tradesToday}
                {guard.remainingTrades === null ? "" : ` / ${settings.maxTradesPerDay}`}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{t("guard.openPositions")}</dt>
              <dd className="num font-medium text-[var(--color-muted)]">
                {guard.openPositions}
                {settings.maxOpenPositions > 0 ? ` / ${settings.maxOpenPositions}` : ""}
              </dd>
            </div>
            {guard.lossStreak >= 2 ? (
              <div className="flex gap-1.5">
                <dt>{t("guard.lossStreak")}</dt>
                <dd className="num font-medium text-[var(--color-short)]">{guard.lossStreak}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </section>
  );
}
