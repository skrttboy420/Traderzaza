"use client";

import { useMemo, useState } from "react";
import { calculateRisk } from "@atc/engine";
import type { Asset } from "@atc/types";

import { useT } from "@/i18n/provider";
import { formatMoney, formatNumber, formatPrice } from "@/lib/format";
import { useSettings } from "@/lib/store";
import { Bullets, Row, SectionTitle, Stat, cx } from "./ui";

/**
 * §28 risk calculator / §29 Small Account Mode.
 *
 * The maths lives in the engine (`calculateRisk`), not here, so the number the
 * user sees on this screen is the same number the journal and the setup page
 * would produce for the same inputs.
 */
export function RiskCalculator({
  asset,
  defaultEntry,
  defaultStop,
}: {
  asset: Asset;
  defaultEntry?: number;
  defaultStop?: number;
}) {
  const t = useT("settings");
  const tt = useT("trading");
  const { settings } = useSettings();

  const [entry, setEntry] = useState(defaultEntry ?? 0);
  const [stop, setStop] = useState(defaultStop ?? 0);

  const result = useMemo(() => {
    if (!entry || !stop || entry === stop) return null;
    return calculateRisk({
      accountBalance: settings.accountBalance,
      riskPercent: settings.riskPercent,
      entryPrice: entry,
      stopLoss: stop,
      asset,
    });
  }, [entry, stop, settings.accountBalance, settings.riskPercent, asset]);

  return (
    <section className="card p-4">
      <SectionTitle
        title={t("account.title")}
        subtitle={`${t("account.balance")}: ${formatMoney(settings.accountBalance, settings.currency)} · ${t("account.riskPercent")}: ${settings.riskPercent}%`}
        hint={settings.smallAccountMode ? t("account.smallAccountHint") : undefined}
      />

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {tt("plan.bestPrice")}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={asset.minTick}
            value={entry || ""}
            onChange={(e) => setEntry(Number(e.target.value))}
            className="num tap mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[14px] outline-none focus:border-[var(--color-border-strong)]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {tt("plan.stopLoss")}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={asset.minTick}
            value={stop || ""}
            onChange={(e) => setStop(Number(e.target.value))}
            className="num tap mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[14px] outline-none focus:border-[var(--color-border-strong)]"
          />
        </label>
      </div>

      {result ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat
              label={tt("plan.size")}
              value={`${formatNumber(result.positionSize, result.unit === "lots" ? 2 : 4)} ${result.unit}`}
            />
            <Stat
              label={t("account.riskPercent")}
              value={formatMoney(result.riskAmount, settings.currency)}
            />
          </div>

          <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
            <Row label={tt("plan.stopLoss")} value={formatPrice(result.stopDistance, asset)} />
            <Row label="pips" value={formatNumber(result.stopDistancePips, 1)} />
          </div>

          {result.warnings.length > 0 ? (
            <div
              className={cx(
                "mt-3 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-3 py-2",
              )}
            >
              <Bullets items={result.warnings} glyph="!" tone="text-[var(--color-wait)]" />
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-faint)]">{tt("plan.entryZone")} / {tt("plan.stopLoss")}</p>
      )}
    </section>
  );
}
