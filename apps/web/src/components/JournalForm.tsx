"use client";

import { useState } from "react";
import { getAsset } from "@atc/market-data";
import { TIMEFRAMES, type Timeframe, type TradeClassification } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import { emptyEntry, type JournalEntry } from "@/lib/store";
import { SectionTitle, cx } from "./ui";

const CLASSIFICATIONS: TradeClassification[] = [
  "valid_win",
  "valid_loss",
  "good_setup_bad_execution",
  "bad_setup",
  "emotional_trade",
  "missed_trade",
];

/**
 * §38-39 journal entry. The classification is the point of this screen: a loss
 * taken correctly and a loss from breaking the plan are different events, and
 * the form makes the user name which one it was.
 */
export function JournalForm({
  symbols,
  initial,
  onSave,
  onCancel,
}: {
  symbols: string[];
  initial?: JournalEntry;
  onSave: (entry: JournalEntry) => void;
  onCancel: () => void;
}) {
  const t = useT("journal");
  const tt = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();

  const [entry, setEntry] = useState<JournalEntry>(
    initial ?? emptyEntry(symbols[0] ?? "XAUUSD", locale),
  );

  const set = <K extends keyof JournalEntry>(key: K, value: JournalEntry[K]) =>
    setEntry((prev) => ({ ...prev, [key]: value }));

  const asset = getAsset(entry.symbol);
  const step = asset?.minTick ?? 0.01;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(entry);
      }}
      className="card space-y-3 p-4"
    >
      <SectionTitle title={initial ? t("edit") : t("add")} />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.symbol")}>
          <select
            value={entry.symbol}
            onChange={(e) => set("symbol", e.target.value)}
            className="input"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label={tt("chart.timeframe")}>
          <select
            value={entry.timeframe}
            onChange={(e) => set("timeframe", e.target.value as Timeframe)}
            className="input"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.direction")}>
          <div className="flex gap-1.5">
            {(["long", "short"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={entry.direction === d}
                onClick={() => set("direction", d)}
                className={cx(
                  "tap flex-1 rounded-lg border text-[12.5px] font-medium",
                  entry.direction === d
                    ? d === "long"
                      ? "border-[var(--color-long)]/50 bg-[var(--color-long-soft)] text-[var(--color-long)]"
                      : "border-[var(--color-short)]/50 bg-[var(--color-short-soft)] text-[var(--color-short)]"
                    : "border-[var(--color-border)] text-[var(--color-faint)]",
                )}
              >
                {tt(`direction.${d}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t("form.size")}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={entry.size || ""}
            onChange={(e) => set("size", Number(e.target.value))}
            className="input num"
          />
        </Field>

        <Field label={t("form.entry")}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={entry.entryPrice || ""}
            onChange={(e) => set("entryPrice", Number(e.target.value))}
            className="input num"
            required
          />
        </Field>

        <Field label={t("form.stop")}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={entry.stopLoss || ""}
            onChange={(e) => set("stopLoss", Number(e.target.value))}
            className="input num"
            required
          />
        </Field>

        <Field label={t("form.exit")}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={entry.exitPrice ?? ""}
            onChange={(e) =>
              set("exitPrice", e.target.value === "" ? null : Number(e.target.value))
            }
            className="input num"
          />
        </Field>

        <Field label={t("form.feeling")}>
          <input
            type="text"
            value={entry.feeling}
            onChange={(e) => set("feeling", e.target.value)}
            className="input"
          />
        </Field>
      </div>

      <Field label={t("classification.label")} hint={t("classification.hint")}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CLASSIFICATIONS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={entry.classification === c}
              onClick={() => set("classification", c)}
              className={cx(
                "rounded-lg border px-3 py-2 text-left",
                entry.classification === c
                  ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                  : "border-[var(--color-border)]",
              )}
            >
              <span className="block text-[12.5px] font-medium">{t(`classification.${c}`)}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-faint)]">
                {t(`classification.${c}_hint`)}
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("form.followedPlan")}>
        <div className="flex gap-1.5">
          {[
            { value: true, label: "✓" },
            { value: false, label: "✕" },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={entry.followedPlan === option.value}
              onClick={() => set("followedPlan", option.value)}
              className={cx(
                "tap flex-1 rounded-lg border text-[13px] font-medium",
                entry.followedPlan === option.value
                  ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                  : "border-[var(--color-border)] text-[var(--color-faint)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("form.note")}>
        <textarea
          value={entry.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("form.notePlaceholder")}
          rows={4}
          className="input resize-y py-2 leading-relaxed"
        />
      </Field>

      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        {t("originalLanguage", { lang: entry.language === "th" ? "ไทย" : "English" })}
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          className="tap flex-1 rounded-lg bg-[var(--color-surface-3)] text-[13px] font-semibold"
        >
          {t("form.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-muted)]"
        >
          {tc("actions.cancel")}
        </button>
      </div>

      <style jsx>{`
        .input {
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
        .input:focus {
          border-color: var(--color-border-strong);
        }
      `}</style>
    </form>
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
      {hint ? (
        <span className="mb-1.5 block text-[11px] leading-snug text-[var(--color-faint)]">{hint}</span>
      ) : null}
      {children}
    </label>
  );
}
