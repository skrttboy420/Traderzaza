"use client";

import type { Phrase } from "@atc/types";
import { useT } from "@/i18n/provider";
import { Bullets, SectionTitle, cx } from "./ui";

/**
 * §35 — the single most important UI rule in the spec. FACT, INTERPRETATION and
 * ASSUMPTION are visually distinct and never mixed into one paragraph, so the
 * user can always tell a measured number from an opinion about it.
 */
export function FactBlock({
  facts,
  interpretation,
  assumptions,
}: {
  facts: Phrase[];
  interpretation: Phrase[];
  assumptions: Phrase[];
}) {
  const t = useT("trading");

  return (
    <div className="space-y-3">
      <Panel
        title={t("explain.facts")}
        hint={t("explain.factsHint")}
        items={facts}
        glyph="="
        accent="border-l-[var(--color-limit)]"
        tone="text-[var(--color-limit)]"
      />
      <Panel
        title={t("explain.interpretation")}
        hint={t("explain.interpretationHint")}
        items={interpretation}
        glyph="~"
        accent="border-l-[var(--color-wait)]"
        tone="text-[var(--color-wait)]"
      />
      <Panel
        title={t("explain.assumptions")}
        hint={t("explain.assumptionsHint")}
        items={assumptions}
        glyph="?"
        accent="border-l-[var(--color-neutral)]"
        tone="text-[var(--color-muted)]"
      />
    </div>
  );
}

function Panel({
  title,
  hint,
  items,
  glyph,
  accent,
  tone,
}: {
  title: string;
  hint: string;
  items: Phrase[];
  glyph: string;
  accent: string;
  tone: string;
}) {
  return (
    <section className={cx("card border-l-2 p-4", accent)}>
      <SectionTitle title={title} hint={hint} />
      <Bullets items={items} glyph={glyph} tone={tone} />
    </section>
  );
}

/** WHY ENTER / WHY WAIT / INVALIDATION — §21 requires all three on every setup. */
export function ReasoningBlock({
  whyEnter,
  whyWait,
  confirmationRequired,
  invalidation,
}: {
  whyEnter: Phrase[];
  whyWait: Phrase[];
  confirmationRequired: Phrase[];
  invalidation: Phrase[];
}) {
  const t = useT("trading");

  return (
    <div className="space-y-3">
      <section className="card border-l-2 border-l-[var(--color-long)] p-4">
        <SectionTitle title={t("explain.whyEnter")} />
        <Bullets items={whyEnter} glyph="+" tone="text-[var(--color-long)]" />
      </section>

      <section className="card border-l-2 border-l-[var(--color-wait)] p-4">
        <SectionTitle title={t("explain.whyWait")} />
        <Bullets items={whyWait} glyph="!" tone="text-[var(--color-wait)]" />
      </section>

      {confirmationRequired.length > 0 ? (
        <section className="card border-l-2 border-l-[var(--color-limit)] p-4">
          <SectionTitle title={t("explain.confirmation")} />
          <Bullets items={confirmationRequired} glyph="→" tone="text-[var(--color-limit)]" />
        </section>
      ) : null}

      <section className="card border-l-2 border-l-[var(--color-short)] p-4">
        <SectionTitle title={t("explain.invalidation")} />
        <Bullets items={invalidation} glyph="✕" tone="text-[var(--color-short)]" />
      </section>
    </div>
  );
}
