"use client";

import type { Asset, MtfAlignment, Phrase, PullbackReading, Setup, SupplyDemandZone } from "@atc/types";

import { impactPhrase } from "@atc/engine";
import { useT, usePhrase } from "@/i18n/provider";
import { formatNumber, formatPrice, formatRange, timeframeLabel } from "@/lib/format";
import { FRESHNESS_VISUAL } from "./visual";
import { Badge, Bullets, Progress, Row, SectionTitle, cx } from "./ui";

/** Zone anatomy — every input the score used, so the grade can be argued with. */
export function ZonePanel({ zone, asset }: { zone: SupplyDemandZone; asset: Asset }) {
  const t = useT("trading");
  const say = usePhrase();
  const fresh = FRESHNESS_VISUAL[zone.freshness];

  return (
    <section className="card p-4">
      <SectionTitle
        title={t(`zone.${zone.kind}`)}
        right={
          <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
            {timeframeLabel(zone.timeframe)}
          </Badge>
        }
      />

      <div className="divide-y divide-[var(--color-border)]">
        <Row label={t("zone.range")} value={formatRange(zone.bottom, zone.top, asset)} />
        <Row
          label={t("zone.freshness")}
          value={
            <span className={fresh.text}>
              <span aria-hidden className="mr-1 text-[10px]">
                {fresh.glyph}
              </span>
              {t(`zone.${zone.freshness}`)}
            </span>
          }
        />
        <Row label={t("zone.tests")} value={zone.tests} />
        <Row label={t("zone.reaction")} value={`${zone.reactionStrength} / 100`} />
        {/* Was `structuralImpact.replace(/_/g, " ")`, which printed the raw
            enum ("caused bos") in English regardless of locale. */}
        <Row label={t("zone.impact")} value={say(impactPhrase(zone.structuralImpact))} />
        <Row
          label={t("zone.htfAligned")}
          value={
            <span className={zone.htfAligned ? "text-[var(--color-long)]" : "text-[var(--color-muted)]"}>
              {zone.htfAligned ? "✓" : "✕"}
            </span>
          }
        />
        <Row label={t("zone.displacement")} value={formatNumber(zone.displacement)} />
      </div>

      {zone.invalidated ? (
        <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] text-[var(--color-short)]">
          {t("zone.invalid")}
        </p>
      ) : null}
    </section>
  );
}

/** §4: the mandatory chain is shown as a chain, with the conflict named. */
export function MtfPanel({ mtf }: { mtf: MtfAlignment }) {
  const t = useT("trading");
  const say = usePhrase();

  return (
    <section className="card p-4">
      <SectionTitle title={t("mtf.label")} subtitle={t("mtf.chain")} />

      <ul className="space-y-2">
        {mtf.legs.map((leg) => (
          <li key={leg.timeframe} className="flex items-center gap-3">
            <span className="num w-8 shrink-0 text-[12px] font-semibold text-[var(--color-muted)]">
              {timeframeLabel(leg.timeframe)}
            </span>
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-[12.5px]",
                leg.trend.includes("bull")
                  ? "text-[var(--color-long)]"
                  : leg.trend.includes("bear")
                    ? "text-[var(--color-short)]"
                    : "text-[var(--color-muted)]",
              )}
            >
              {t(`trend.${leg.trend}`)}
            </span>
            <span className="shrink-0 text-[11.5px] text-[var(--color-faint)]">
              {t(`phase.${leg.phase}`)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] text-[var(--color-muted)]">{t("mtf.agreement")}</span>
          <span className="num text-[12.5px] font-semibold">{mtf.agreement}</span>
        </div>
        <Progress
          value={mtf.agreement}
          tone={
            mtf.agreement >= 70
              ? "bg-[var(--color-long)]"
              : mtf.agreement >= 40
                ? "bg-[var(--color-wait)]"
                : "bg-[var(--color-short)]"
          }
        />
        <p
          className={cx(
            "mt-2 text-[12px] leading-relaxed",
            mtf.conflict ? "text-[var(--color-wait)]" : "text-[var(--color-faint)]",
          )}
        >
          {mtf.conflict ? `${t("mtf.conflict")}: ${say(mtf.conflict)}` : t("mtf.noConflict")}
        </p>
      </div>
    </section>
  );
}

/** §7: pullback vs reversal, with the classifier's own reasoning exposed. */
export function PullbackPanel({ pullback }: { pullback: PullbackReading }) {
  const t = useT("trading");

  const tone =
    pullback.verdict === "pullback"
      ? "text-[var(--color-long)]"
      : pullback.verdict === "reversal"
        ? "text-[var(--color-short)]"
        : "text-[var(--color-muted)]";

  return (
    <section className="card p-4">
      <SectionTitle title={t("pullback.label")} />
      <div className="flex items-baseline justify-between gap-3">
        <span className={cx("text-[15px] font-semibold", tone)}>
          {t(`pullback.${pullback.verdict}`)}
        </span>
        <span className="num text-[12px] text-[var(--color-faint)]">
          {t("pullback.strength")}: {pullback.strength}
        </span>
      </div>
      <div className="mt-2">
        <Progress value={pullback.strength} tone="bg-[var(--color-limit)]" />
      </div>
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <Bullets items={pullback.reasons} glyph="–" />
      </div>
    </section>
  );
}

/** §30: when the engine refuses, the refusal is a first-class answer. */
export function NoTradePanel({ reasons }: { reasons: Phrase[] }) {
  const t = useT("trading");

  return (
    <section className="card border-l-2 border-l-[var(--color-short)] p-4">
      <SectionTitle title={t("noTrade.title")} subtitle={t("noTrade.reasons")} />
      <Bullets items={reasons} glyph="✕" tone="text-[var(--color-short)]" />
    </section>
  );
}

/** §14 lifecycle rail, so the user can see where in the sequence this setup is. */
export function LifecycleRail({ setup }: { setup: Setup }) {
  const t = useT("trading");
  const order = [
    "WATCHING",
    "ZONE_APPROACHING",
    "IN_ZONE",
    "WAITING_CONFIRMATION",
    "ENTRY_VALID",
  ] as const;
  const dead = setup.status === "INVALIDATED";
  const activeIndex = order.indexOf(setup.status as (typeof order)[number]);

  return (
    <div className="scroll-x -mx-1 flex items-center gap-1 px-1">
      {order.map((status, i) => {
        const reached = !dead && activeIndex >= i;
        const current = !dead && activeIndex === i;
        return (
          <div key={status} className="flex shrink-0 items-center gap-1">
            <span
              className={cx(
                "rounded px-1.5 py-1 text-[10.5px] leading-none",
                current
                  ? "bg-[var(--color-limit-soft)] font-semibold text-[var(--color-limit)]"
                  : reached
                    ? "text-[var(--color-muted)]"
                    : "text-[var(--color-faint)]",
              )}
            >
              {t(`setupStatus.${status}`)}
            </span>
            {i < order.length - 1 ? (
              <span aria-hidden className="text-[9px] text-[var(--color-faint)]">
                ›
              </span>
            ) : null}
          </div>
        );
      })}
      {dead ? (
        <Badge
          glyph="✕"
          className="ml-1 shrink-0 border-[var(--color-short)]/40 bg-[var(--color-short-soft)] text-[var(--color-short)]"
        >
          {t("setupStatus.INVALIDATED")}
        </Badge>
      ) : null}
    </div>
  );
}

/** Price + regime strip under the chart header. */
export function MarketHeader({
  symbol,
  price,
  asset,
  regime,
  trendLabelText,
}: {
  symbol: string;
  price: number;
  asset: Asset;
  regime: string;
  trendLabelText: string;
}) {
  const t = useT("trading");

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-[20px] font-bold tracking-tight">{symbol}</h1>
      <span className="num text-[17px] font-semibold">{formatPrice(price, asset)}</span>
      <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
        {t("regime.label")}: {regime}
      </Badge>
      <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">{trendLabelText}</Badge>
    </div>
  );
}
