"use client";

import type { SetupQuality } from "@atc/types";

import { useT, usePhrase } from "@/i18n/provider";
import { QUALITY_VISUAL } from "./visual";
import { Progress, SectionTitle, cx } from "./ui";

/**
 * §16: the score is never a bare number. Every component, its weight and its
 * own sub-score are visible so the user can disagree with the engine on a
 * specific point rather than having to trust or reject the whole figure.
 *
 * §17: Setup Quality and AI Confidence are rendered as two separate things, and
 * the "not a win probability" line is always present.
 */
export function ScoreBreakdown({
  quality,
  aiConfidence,
  showConfidence = true,
}: {
  quality: SetupQuality;
  aiConfidence: number;
  showConfidence?: boolean;
}) {
  const t = useT("trading");
  const say = usePhrase();
  const grade = QUALITY_VISUAL[quality.grade];

  return (
    <section className="card p-4">
      <SectionTitle title={t("quality.label")} hint={t("quality.notProbability")} />

      <div className="flex items-end gap-4">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={cx("num text-[32px] font-bold leading-none", grade.text)}>
              {quality.score}
            </span>
            <span className="text-[13px] text-[var(--color-faint)]">/ 100</span>
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("quality.grade")}{" "}
            <span className={cx("num font-semibold", grade.text)}>{quality.grade}</span>
          </div>
        </div>

        {showConfidence ? (
          <div className="ml-auto text-right">
            <div className="num text-[20px] font-semibold leading-none text-[var(--color-muted)]">
              {aiConfidence}
            </div>
            <div className="mt-1 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("confidence.label")}
            </div>
          </div>
        ) : null}
      </div>

      {showConfidence ? (
        <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          {t("confidence.hint")}
        </p>
      ) : null}

      <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
          <span>{t("quality.component")}</span>
          <span>{t("quality.weight")}</span>
        </div>

        {quality.components.map((component) => (
          <div key={component.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12.5px] font-medium">{say(component.label)}</span>
              <span className="num shrink-0 text-[11.5px] text-[var(--color-faint)]">
                {Math.round(component.weight * 100)}%
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Progress
                value={component.score}
                tone={
                  component.score >= 70
                    ? "bg-[var(--color-long)]"
                    : component.score >= 40
                      ? "bg-[var(--color-wait)]"
                      : "bg-[var(--color-neutral)]"
                }
              />
              <span className="num w-8 shrink-0 text-right text-[11.5px] text-[var(--color-muted)]">
                {component.score}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-faint)]">
              {say(component.note)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
