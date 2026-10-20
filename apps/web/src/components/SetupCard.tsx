"use client";

import Link from "next/link";
import type { Setup } from "@atc/types";

import { useT, usePhrase } from "@/i18n/provider";
import { setupAffordability } from "@/lib/afford";
import { formatMoney, formatPrice, formatRange, formatRr, timeframeLabel } from "@/lib/format";
import { isInvalidated, primaryPlan } from "@/lib/setup";
import { setupHref } from "@/lib/setup";
import { useSettings } from "@/lib/store";
import { QUALITY_VISUAL, SCANNER_VISUAL, directionVisual } from "./visual";
import { Badge, cx } from "./ui";

/**
 * §56 setup card. Shows, in this order: what the market is, what state the
 * setup is in, how good the setup is (quality — never a win probability), where
 * the entry is, and the single most important reason to wait.
 *
 * §57: an invalidated setup is dimmed and labelled, never removed.
 */
export function SetupCard({
  setup,
  rank,
  showConfidence = true,
  cta,
}: {
  setup: Setup;
  rank?: number;
  showConfidence?: boolean;
  /**
   * Optional call-to-action label. Rendered as a styled `span`, not a nested
   * link: the whole card is already an anchor, and an `<a>` inside an `<a>` is
   * invalid HTML that React will not even hydrate reliably. This gives the
   * signal screen the explicit "go to full detail" button it needs without
   * changing how the card navigates.
   */
  cta?: string;
}) {
  const t = useT("trading");
  const say = usePhrase();
  const { settings, loaded: settingsLoaded } = useSettings();
  const dead = isInvalidated(setup);
  const scanner = SCANNER_VISUAL[setup.scannerState];
  const dir = directionVisual(setup.direction);
  const grade = QUALITY_VISUAL[setup.quality.grade];
  const plan = primaryPlan(setup);

  // Gated on `loaded` rather than rendered optimistically. Before localStorage
  // comes back the balance is the $1,000 default, and a card that says "too
  // wide for your account" and then changes its mind a frame later teaches the
  // trader to distrust the one label that is supposed to stop a bad trade.
  const afford = settingsLoaded && !dead ? setupAffordability(setup, settings) : null;

  // Lead with the blocker when there is one, otherwise the reason to enter.
  const leadPhrase = setup.whyWait[0] ?? setup.whyEnter[0] ?? null;
  const lead = leadPhrase ? say(leadPhrase) : null;

  return (
    <Link
      href={setupHref(setup)}
      className={cx(
        "card block p-3.5 transition-colors hover:border-[var(--color-border-strong)]",
        dead && "opacity-55",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {rank !== undefined ? (
            <span className="num shrink-0 rounded-md bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-muted)]">
              #{rank}
            </span>
          ) : null}
          <span className="truncate text-[15px] font-semibold tracking-tight">{setup.symbol}</span>
          <span className="num shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-muted)]">
            {timeframeLabel(setup.timeframe)}
          </span>
          <Badge glyph={dir.glyph} className={cx(dir.text, dir.bg, dir.border)}>
            {t(`direction.${setup.direction}`)}
          </Badge>
        </div>

        <Badge
          glyph={grade.glyph}
          className={cx(grade.text, grade.bg, grade.border, "shrink-0")}
          title={t("quality.notProbability")}
        >
          <span className="num">{setup.quality.score}</span>
        </Badge>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge glyph={scanner.glyph} className={cx(scanner.text, scanner.bg, scanner.border)}>
          {t(`scannerState.${setup.scannerState}`)}
        </Badge>
        <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
          {t(`setupStatus.${setup.status}`)}
        </Badge>
        {dead ? (
          <Badge
            glyph="✕"
            className="border-[var(--color-short)]/40 bg-[var(--color-short-soft)] text-[var(--color-short)]"
          >
            {t("setupStatus.INVALIDATED")}
          </Badge>
        ) : null}
      </div>

      {plan && !dead ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
          <div className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("plan.entryZone")}
            </dt>
            <dd className="num mt-0.5 truncate text-[12.5px] font-medium">
              {formatRange(plan.entryZone.low, plan.entryZone.high)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("plan.stopLoss")}
            </dt>
            <dd className="num mt-0.5 truncate text-[12.5px] font-medium text-[var(--color-short)]">
              {formatPrice(plan.stopLoss)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("plan.riskReward")}
            </dt>
            <dd className="num mt-0.5 truncate text-[12.5px] font-medium">{formatRr(plan.riskReward)}</dd>
          </div>
        </dl>
      ) : null}

      {/* The stop measured in the units a retail platform shows, against what
          this balance can carry. A setup can be grade A and still be one this
          account cannot size — that is a fact about the account, and it
          belongs on the card rather than three taps away. */}
      {afford ? (
        <p
          className={cx(
            "mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed",
            afford.affordable ? "text-[var(--color-faint)]" : "text-[var(--color-short)]",
          )}
        >
          <span aria-hidden>{afford.affordable ? "◇" : "✕"}</span>
          <span>
            {t("afford.stopPoints", { points: afford.stopPoints.toLocaleString() })}
            {" · "}
            {t("afford.ceiling", { points: afford.ceiling.points.toLocaleString() })}
          </span>
          {afford.affordable ? null : (
            <span className="font-medium">
              {t("afford.needs", {
                balance: formatMoney(afford.balanceNeeded, settings.currency),
              })}
            </span>
          )}
        </p>
      ) : null}

      {lead ? (
        <p className="mt-3 line-clamp-2 border-t border-[var(--color-border)] pt-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          <span className="text-[var(--color-faint)]">
            {setup.whyWait[0] ? `${t("explain.whyWait")}: ` : `${t("explain.whyEnter")}: `}
          </span>
          {lead}
        </p>
      ) : null}

      {showConfidence ? (
        <p className="mt-2 text-[11px] text-[var(--color-faint)]">
          {t("confidence.label")}: <span className="num">{setup.aiConfidence}</span> ·{" "}
          {t("quality.label")}: <span className="num">{setup.quality.score}</span>
        </p>
      ) : null}

      {cta ? (
        <span className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-text)]">
          {cta}
          <span aria-hidden>→</span>
        </span>
      ) : null}
    </Link>
  );
}
