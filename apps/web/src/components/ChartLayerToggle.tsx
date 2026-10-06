"use client";

import type { Timeframe } from "@atc/types";

import { useT } from "@/i18n/provider";
import { timeframeLabel } from "@/lib/format";
import type { ChartLayers } from "@/lib/settings";
import { cx } from "./ui";

/** §55: each overlay is independently switchable, and the control says what it does. */
export function ChartLayerToggle({
  layers,
  onChange,
}: {
  layers: ChartLayers;
  onChange: (next: ChartLayers) => void;
}) {
  const t = useT("trading");

  const items: { key: keyof ChartLayers; label: string }[] = [
    { key: "swings", label: t("chart.swings") },
    { key: "structure", label: t("chart.structure") },
    { key: "zones", label: t("chart.zones") },
    { key: "entries", label: t("chart.entries") },
  ];

  return (
    <div className="scroll-x -mx-1 flex gap-1.5 px-1">
      {items.map((item) => {
        const on = layers[item.key];
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...layers, [item.key]: !on })}
            className={cx(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium",
              on
                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-faint)]",
            )}
          >
            <span aria-hidden className="text-[9px]">
              {on ? "●" : "○"}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TimeframeToggle({
  value,
  options,
  onChange,
}: {
  value: Timeframe;
  options: Timeframe[];
  onChange: (next: Timeframe) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
      {options.map((tf) => (
        <button
          key={tf}
          type="button"
          aria-pressed={tf === value}
          onClick={() => onChange(tf)}
          className={cx(
            "num h-8 px-2.5 text-[11.5px] font-medium",
            tf === value
              ? "bg-[var(--color-surface-3)] text-[var(--color-text)]"
              : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
          )}
        >
          {timeframeLabel(tf)}
        </button>
      ))}
    </div>
  );
}
