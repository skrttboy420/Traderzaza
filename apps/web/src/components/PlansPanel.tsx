"use client";

import { useState } from "react";
import type { Asset, EntryPlan } from "@atc/types";

import { useT, usePhrase } from "@/i18n/provider";
import { formatPrice, formatRange, formatRr, formatSizeFraction } from "@/lib/format";
import { Badge, Bullets, Row, SectionTitle, cx } from "./ui";

/**
 * §15 Conservative / Balanced / Aggressive side by side.
 * §18 Best Price vs Safer Price are both shown with their trade-off spelled
 *     out, so the user chooses rather than being nudged.
 * §19 the entry is a range, never a single magic number.
 * §9  a probe is labelled as not the full position.
 */
export function PlansPanel({
  plans,
  asset,
  selected,
  onSelect,
}: {
  plans: EntryPlan[];
  asset: Asset;
  selected?: string;
  onSelect?: (planId: string) => void;
}) {
  const t = useT("trading");
  const say = usePhrase();
  const [open, setOpen] = useState(selected ?? plans[0]?.id ?? "");

  const activeId = selected ?? open;

  const choose = (id: string) => {
    setOpen(id);
    onSelect?.(id);
  };

  if (plans.length === 0) return null;

  return (
    <section className="card p-4">
      <SectionTitle title={t("plan.label")} />

      <div className="scroll-x -mx-1 mb-3 flex gap-1.5 px-1">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            aria-pressed={plan.id === activeId}
            onClick={() => choose(plan.id)}
            className={cx(
              "h-9 shrink-0 rounded-md border px-3 text-[12px] font-medium",
              plan.id === activeId
                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-faint)]",
            )}
          >
            {t(`plan.${plan.name}`)}
          </button>
        ))}
      </div>

      {plans
        .filter((plan) => plan.id === activeId)
        .map((plan) => (
          <div key={plan.id}>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
                {t("plan.entryType")}: {t(`entryType.${plan.entryType}`)}
              </Badge>
              <Badge
                className={cx(
                  plan.sizeFraction < 1
                    ? "border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]",
                )}
              >
                {plan.sizeFraction < 1
                  ? `${t("plan.sizeProbe")} · ${formatSizeFraction(plan.sizeFraction)}`
                  : t("plan.sizeFull")}
              </Badge>
            </div>

            <div className="divide-y divide-[var(--color-border)]">
              <Row
                label={t("plan.entryZone")}
                value={formatRange(plan.entryZone.low, plan.entryZone.high, asset)}
              />
              <Row label={t("plan.bestPrice")} value={formatPrice(plan.bestPrice, asset)} />
              <Row label={t("plan.saferPrice")} value={formatPrice(plan.saferPrice, asset)} />
              <Row
                label={t("plan.stopLoss")}
                value={formatPrice(plan.stopLoss, asset)}
                tone="text-[var(--color-short)]"
              />
              <Row label={t("plan.riskReward")} value={formatRr(plan.riskReward)} />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                <span className="font-medium text-[var(--color-muted)]">{t("plan.bestPrice")}: </span>
                {t("plan.bestPriceHint")}
              </p>
              <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                <span className="font-medium text-[var(--color-muted)]">{t("plan.saferPrice")}: </span>
                {t("plan.saferPriceHint")}
              </p>
            </div>

            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("plan.stopLoss")}
              </p>
              <p className="text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
                {say(plan.stopLossReason)}
              </p>
            </div>

            {plan.takeProfits.length > 0 ? (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                  {t("plan.takeProfit")}
                </p>
                <ul className="space-y-2">
                  {plan.takeProfits.map((tp, i) => (
                    <li key={i}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-medium">{tp.label}</span>
                        <span className="num text-[12.5px] text-[var(--color-long)]">
                          {formatPrice(tp.price, asset)}{" "}
                          <span className="text-[var(--color-faint)]">({formatRr(tp.rr)})</span>
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-faint)]">
                        {say(tp.reason)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.notes.length > 0 ? (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                  {t("plan.notes")}
                </p>
                <Bullets items={plan.notes} glyph="–" />
              </div>
            ) : null}
          </div>
        ))}
    </section>
  );
}
