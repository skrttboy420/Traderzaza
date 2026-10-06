"use client";

import { useState } from "react";
import type { ScannerState, Setup } from "@atc/types";

import { SetupCard } from "@/components/SetupCard";
import { TopBar } from "@/components/TopBar";
import { Badge, Disclaimer, Empty, SectionTitle, cx } from "@/components/ui";
import { SCANNER_ORDER, SCANNER_VISUAL } from "@/components/visual";
import { useT } from "@/i18n/provider";
import { useSettings } from "@/lib/store";

export interface SetupsData {
  buckets: Record<ScannerState, Setup[]>;
  scannedAt: number;
}

/**
 * §8 the five scanner states as the primary organising idea, and §13: an
 * invalidated setup stays in its bucket, dimmed and labelled, so the user can
 * review what the read got wrong instead of it quietly disappearing.
 */
export function SetupsView({ data }: { data: SetupsData }) {
  const t = useT("trading");
  const tc = useT("common");
  const { settings } = useSettings();

  const [filter, setFilter] = useState<ScannerState | "ALL">("ALL");

  const visibleStates = filter === "ALL" ? SCANNER_ORDER : [filter];
  const total = SCANNER_ORDER.reduce((sum, state) => sum + (data.buckets[state]?.length ?? 0), 0);

  return (
    <>
      <TopBar title={t("setups.title")} subtitle={t("setups.subtitle")} />

      <main className="space-y-4 p-4">
        <div className="scroll-x -mx-1 flex gap-1.5 px-1">
          <button
            type="button"
            aria-pressed={filter === "ALL"}
            onClick={() => setFilter("ALL")}
            className={cx(
              "h-9 shrink-0 rounded-md border px-3 text-[12px] font-medium",
              filter === "ALL"
                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-faint)]",
            )}
          >
            {t("setups.title")} <span className="num ml-1">{total}</span>
          </button>

          {SCANNER_ORDER.map((state) => {
            const visual = SCANNER_VISUAL[state];
            const count = data.buckets[state]?.length ?? 0;
            return (
              <button
                key={state}
                type="button"
                aria-pressed={filter === state}
                onClick={() => setFilter(state)}
                className={cx(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium",
                  filter === state
                    ? cx(visual.bg, visual.border, visual.text)
                    : "border-[var(--color-border)] text-[var(--color-faint)]",
                  count === 0 && filter !== state && "opacity-50",
                )}
              >
                <span aria-hidden className="text-[9px]">
                  {visual.glyph}
                </span>
                {t(`scannerState.${state}`)}
                <span className="num">{count}</span>
              </button>
            );
          })}
        </div>

        <p className="text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          {t("setups.invalidatedKept")}
        </p>

        {total === 0 ? <Empty title={t("dashboard.noOpportunities")} /> : null}

        {visibleStates.map((state) => {
          const setups = data.buckets[state] ?? [];
          if (setups.length === 0) return null;
          const visual = SCANNER_VISUAL[state];

          return (
            <section key={state}>
              <SectionTitle
                title={t(`scannerState.${state}`)}
                right={
                  <Badge glyph={visual.glyph} className={cx(visual.text, visual.bg, visual.border)}>
                    <span className="num">{setups.length}</span>
                  </Badge>
                }
              />
              <ul className="space-y-2.5">
                {setups.map((setup) => (
                  <li key={setup.id}>
                    <SetupCard setup={setup} showConfidence={settings.showAiConfidence} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
