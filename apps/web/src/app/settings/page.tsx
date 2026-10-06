"use client";

import { useEffect, useMemo, useState } from "react";
import { smallAccountSizeFraction } from "@atc/engine";
import { ASSETS, getAsset } from "@atc/market-data";
import { MTF_CHAIN, TIMEFRAMES, type DataQuality, type Timeframe } from "@atc/types";

import { AccountPanel } from "@/components/AccountPanel";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, Disclaimer, Row, SectionTitle, cx } from "@/components/ui";
import { DATA_VISUAL } from "@/components/visual";
import { useT } from "@/i18n/provider";
import { formatMoney, formatNumber, timeframeLabel } from "@/lib/format";
import type { ChartLayers } from "@/lib/settings";
import { clearLocalData, exportLocalData, useSettings } from "@/lib/store";

interface StatusPayload {
  capabilities: {
    llm: boolean;
    database: boolean;
    liveCrypto: boolean;
    liveForex: boolean;
    forcedDemo: boolean;
  };
  candleLimit: number;
  aiModel: string | null;
  providers: {
    symbol: string;
    display: string;
    assetClass: string;
    provider: string;
    quality: DataQuality;
  }[];
}

const LAYER_KEYS: (keyof ChartLayers)[] = ["swings", "structure", "zones", "entries"];
const GRADES = ["A", "B", "C", "D"] as const;
const ALERT_KEYS = ["newSetup", "entryValid", "approaching", "invalidated", "qualityJump"] as const;
const LIMITATIONS = ["data", "llm", "storage", "news", "realtime", "backtest"] as const;

/**
 * §28-29 risk settings, §61-65 language, §54/§71 honest data-source reporting,
 * §20 alert preferences, §85.9 known limitations.
 *
 * Capability information is fetched from /api/status rather than read from env
 * here, because this file is a client component and the keys must never reach
 * the browser bundle (§77).
 */
export default function SettingsPage() {
  const t = useT("settings");
  const tt = useT("trading");
  const tc = useT("common");
  const tj = useT("journal");
  const tco = useT("coach");

  const { settings, patch, reset } = useSettings();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [symbolToAdd, setSymbolToAdd] = useState("");
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/status");
        if (!response.ok) return;
        const payload = (await response.json()) as StatusPayload;
        if (!cancelled) setStatus(payload);
      } catch {
        // The screen still works without it; the capability blocks just stay hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const riskAmount = (settings.accountBalance * settings.riskPercent) / 100;
  const riskTooHigh = settings.riskPercent > 2;

  const available = useMemo(
    () => ASSETS.filter((a) => !settings.watchlist.includes(a.symbol)),
    [settings.watchlist],
  );

  // §29: show what Small Account Mode actually does to the size, per market,
  // instead of just claiming it is "safer".
  const sizeFractions = useMemo(
    () =>
      settings.watchlist
        .map((symbol) => {
          const asset = getAsset(symbol);
          if (!asset) return null;
          return {
            symbol,
            fraction: smallAccountSizeFraction(settings.accountBalance, asset),
          };
        })
        .filter((row): row is { symbol: string; fraction: number } => row !== null),
    [settings.watchlist, settings.accountBalance],
  );

  return (
    <>
      <TopBar title={t("title")} />

      <main className="space-y-4 p-4">
        {/* ---------- account: who you are, and sign out (§77) ---------- */}
        <AccountPanel />

        {/* ---------- language (§61-62) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("display.language")} />
          <LocaleSwitch />
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
            {t("ai.languageHint")}
          </p>
        </section>

        {/* ---------- account and risk (§28-29) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("account.title")} />

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("account.balance")}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={10}
                value={settings.accountBalance || ""}
                onChange={(e) => patch({ accountBalance: Number(e.target.value) })}
                className="field num"
              />
            </Field>
            <Field label={t("account.currency")}>
              <input
                type="text"
                value={settings.currency}
                onChange={(e) => patch({ currency: e.target.value.toUpperCase().slice(0, 4) })}
                className="field"
              />
            </Field>
            <Field label={t("account.riskPercent")} hint={t("account.riskPercentHint")}>
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                max={10}
                step={0.1}
                value={settings.riskPercent || ""}
                onChange={(e) => patch({ riskPercent: Number(e.target.value) })}
                className="field num"
              />
            </Field>
            <Field label={t("account.maxTradesPerDay")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                value={settings.maxTradesPerDay || ""}
                onChange={(e) => patch({ maxTradesPerDay: Number(e.target.value) })}
                className="field num"
              />
            </Field>
            <Field label={t("account.maxOpenPositions")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                step={1}
                value={settings.maxOpenPositions || ""}
                onChange={(e) => patch({ maxOpenPositions: Number(e.target.value) })}
                className="field num"
              />
            </Field>
          </div>

          <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
            <Row
              label={`1R (${settings.riskPercent}%)`}
              value={formatMoney(riskAmount, settings.currency)}
            />
          </div>

          {riskTooHigh ? (
            <p className="mt-2.5 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-wait)]">
              {t("account.riskWarning")}
            </p>
          ) : null}

          <Toggle
            label={t("account.smallAccount")}
            hint={t("account.smallAccountHint")}
            value={settings.smallAccountMode}
            onChange={(smallAccountMode) => patch({ smallAccountMode })}
          />

          {settings.smallAccountMode && sizeFractions.length > 0 ? (
            <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
              {sizeFractions.map((row) => (
                <Row
                  key={row.symbol}
                  label={row.symbol}
                  value={`${formatNumber(row.fraction * 100, 0)}%`}
                  tone={row.fraction < 1 ? "text-[var(--color-wait)]" : undefined}
                />
              ))}
            </div>
          ) : null}
        </section>

        {/* ---------- watchlist (§31) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("watchlist.title")} subtitle={t("watchlist.subtitle")} />

          {settings.watchlist.length === 0 ? (
            <p className="text-[12px] text-[var(--color-faint)]">{t("watchlist.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {settings.watchlist.map((symbol) => {
                const asset = getAsset(symbol);
                return (
                  <li key={symbol} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{symbol}</p>
                      {asset ? (
                        <p className="truncate text-[11px] text-[var(--color-faint)]">
                          {asset.display}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={settings.watchlist.length <= 1}
                      onClick={() =>
                        patch({ watchlist: settings.watchlist.filter((s) => s !== symbol) })
                      }
                      className="shrink-0 text-[11.5px] text-[var(--color-faint)] disabled:opacity-40"
                    >
                      {t("watchlist.remove")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {available.length > 0 ? (
            <div className="mt-3 flex gap-2">
              <select
                value={symbolToAdd}
                onChange={(e) => setSymbolToAdd(e.target.value)}
                className="field min-w-0 flex-1"
              >
                <option value="">—</option>
                {available.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol} · {asset.display}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!symbolToAdd}
                onClick={() => {
                  patch({ watchlist: [...settings.watchlist, symbolToAdd] });
                  setSymbolToAdd("");
                }}
                className="tap shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] px-4 text-[12.5px] font-semibold disabled:opacity-40"
              >
                {t("watchlist.add")}
              </button>
            </div>
          ) : null}
        </section>

        {/* ---------- timeframes (§4) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("timeframes.title")} />

          <Field label={t("timeframes.entryTimeframe")}>
            <select
              value={settings.entryTimeframe}
              onChange={(e) => patch({ entryTimeframe: e.target.value as Timeframe })}
              className="field"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {timeframeLabel(tf)}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <p className="num text-[12.5px] font-medium">
              {MTF_CHAIN.map((tf) => tf.toUpperCase()).join(" → ")}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
              {t("timeframes.chainLocked")}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
              {t("timeframes.chainWhy")}
            </p>
          </div>
        </section>

        {/* ---------- data sources (§54, §71) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("data.title")} subtitle={t("data.subtitle")} />

          <Field label={t("data.refreshInterval")}>
            <input
              type="number"
              inputMode="numeric"
              min={15}
              max={600}
              step={5}
              value={settings.refreshSeconds || ""}
              onChange={(e) => patch({ refreshSeconds: Number(e.target.value) })}
              className="field num"
            />
          </Field>

          {status ? (
            <>
              <p className="mt-3 mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("data.perSymbol")}
              </p>
              <ul className="divide-y divide-[var(--color-border)]">
                {status.providers.map((row) => {
                  const visual = DATA_VISUAL[row.quality];
                  return (
                    <li key={row.symbol} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium">{row.symbol}</p>
                        <p className="truncate text-[11px] text-[var(--color-faint)]">
                          {row.provider}
                        </p>
                      </div>
                      <Badge
                        glyph={visual.glyph}
                        className={cx("shrink-0", visual.text, visual.bg, visual.border)}
                      >
                        {tc(`dataQuality.${row.quality}`)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {status.capabilities.forcedDemo ? (
                <p className="mt-3 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-wait)]">
                  {t("data.forceDemoHint")}
                </p>
              ) : null}

              {!status.capabilities.liveForex ? (
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                  {t("data.noKeyNotice")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--color-faint)]">{tc("state.loading")}</p>
          )}
        </section>

        {/* ---------- AI (§52, §70) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("ai.title")} />
          <div className="divide-y divide-[var(--color-border)]">
            <Row
              label={t("ai.provider")}
              value={status ? (status.aiModel ?? tc("dataQuality.DEMO")) : "—"}
            />
            <Row label={t("ai.mode")} value={tco(`mode.${settings.coachMode}`)} />
            <Row label={t("ai.level")} value={tco(`level.${settings.explanationLevel}`)} />
          </div>
          {status && !status.capabilities.llm ? (
            <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
              {t("ai.noKeyNotice")}
            </p>
          ) : null}
          <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {t("about.howItWorks")}
          </p>
        </section>

        {/* ---------- alerts (§20) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("alerts.title")} subtitle={t("alerts.subtitle")} />
          {ALERT_KEYS.map((key) => (
            <Toggle
              key={key}
              label={t(`alerts.${key}`)}
              value={settings.alerts[key]}
              onChange={(next) => patch({ alerts: { ...settings.alerts, [key]: next } })}
            />
          ))}

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("alerts.minGrade")}
            </p>
            <div className="flex gap-1.5">
              {GRADES.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  aria-pressed={settings.alerts.minGrade === grade}
                  onClick={() => patch({ alerts: { ...settings.alerts, minGrade: grade } })}
                  className={cx(
                    "tap num flex-1 rounded-lg border text-[13px] font-semibold",
                    settings.alerts.minGrade === grade
                      ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                      : "border-[var(--color-border)] text-[var(--color-faint)]",
                  )}
                >
                  {grade}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- display (§17, §55) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("display.title")} />

          {/* Also in the TopBar, because changing a theme is something you do
              while looking at the thing you want to change. This copy is here
              for discoverability and because the hint explaining "System"
              needs somewhere to live. */}
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("display.theme")}
          </p>
          <ThemeSwitch />
          <p className="mt-2 mb-3 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
            {t("appearance.hint")}
          </p>

          <Toggle
            label={t("display.showConfidence")}
            hint={t("display.showConfidenceHint")}
            value={settings.showAiConfidence}
            onChange={(showAiConfidence) => patch({ showAiConfidence })}
          />

          <p className="mt-3 mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("display.chartLayers")}
          </p>
          {LAYER_KEYS.map((key) => (
            <Toggle
              key={key}
              label={tt(`chart.${key}`)}
              value={settings.chartLayers[key]}
              onChange={(next) => patch({ chartLayers: { ...settings.chartLayers, [key]: next } })}
            />
          ))}
        </section>

        {/* ---------- storage (§49 fallback) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("storage.title")} />
          <div className="divide-y divide-[var(--color-border)]">
            <Row
              label={t("storage.mode")}
              value={
                status?.capabilities.database ? t("storage.supabase") : t("storage.localOnly")
              }
            />
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([exportLocalData()], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `atc-export-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
            >
              {tj("storage.export")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t("storage.clearConfirm"))) return;
                clearLocalData();
                reset();
                setCleared(true);
              }}
              className="tap flex-1 rounded-lg border border-[var(--color-short)]/40 text-[12.5px] font-medium text-[var(--color-short)]"
            >
              {t("storage.clear")}
            </button>
          </div>

          {cleared ? (
            <p className="mt-2.5 text-[11.5px] text-[var(--color-long)]">{t("saved")}</p>
          ) : null}

          <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {tj("storage.localHint")}
          </p>

          <button
            type="button"
            onClick={() => reset()}
            className="tap mt-3 w-full rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-faint)]"
          >
            {t("resetDefaults")}
          </button>
        </section>

        {/* ---------- about + known limitations (§83, §85.9) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("about.title")} />

          <p className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("about.whatThisIs")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
            {t("about.whatThisIsBody")}
          </p>

          <p className="mt-3 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("about.whatThisIsNot")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
            {t("about.whatThisIsNotBody")}
          </p>

          <p className="mt-3 mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("about.limitations")}
          </p>
          <Bullets items={LIMITATIONS.map((key) => t(`about.limits.${key}`))} glyph="!" />
        </section>

        <Disclaimer text={tc("disclaimer")} />

        <style jsx>{`
          .field {
            width: 100%;
            min-height: 2.75rem;
            border-radius: 0.5rem;
            border: 1px solid var(--color-border);
            background: var(--color-surface-2);
            padding-left: 0.75rem;
            padding-right: 0.75rem;
            font-size: 13.5px;
            color: var(--color-text);
            outline: none;
          }
          .field:focus {
            border-color: var(--color-border-strong);
          }
        `}</style>
      </main>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] leading-snug text-[var(--color-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-faint)]">{hint}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors",
          value
            ? "border-[var(--color-long)]/50 bg-[var(--color-long-soft)]"
            : "border-[var(--color-border)] bg-[var(--color-surface-3)]",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full transition-[left]",
            value ? "left-[1.5rem] bg-[var(--color-long)]" : "left-1 bg-[var(--color-faint)]",
          )}
        />
      </button>
    </div>
  );
}
