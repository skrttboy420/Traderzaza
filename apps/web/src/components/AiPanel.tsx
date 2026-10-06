"use client";

import { useCallback, useState } from "react";
import type { ExplanationLevel, Setup } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import type { CoachMode } from "@/lib/settings";
import { Badge, SectionTitle, cx } from "./ui";

type Intent = "teach" | "whatif" | "grade";

export interface AiRequest {
  intent: Intent;
  symbol: string;
  setupId: string;
  input?: string;
}

/** Renders the markdown-ish text the AI layer returns without a parser dependency. */
export function AiText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*•]\s/.test(l));

        if (isList) {
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-2 text-[13px] leading-relaxed">
                  <span aria-hidden className="shrink-0 text-[var(--color-faint)]">
                    –
                  </span>
                  <span className="min-w-0">{inline(line.replace(/^\s*[-*•]\s/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="text-[13px] leading-relaxed text-[var(--color-text)]/90">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

/** Minimal **bold** handling — the AI output uses it for FACT / INTERPRETATION headers. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[var(--color-text)]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

async function askAi(body: Record<string, unknown>): Promise<{ content: string; source: string }> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { content?: string; source?: string; error?: string };
  if (!response.ok || !payload.content) throw new Error(payload.error ?? "request failed");
  return { content: payload.content, source: payload.source ?? "deterministic" };
}

/**
 * §22 "Teach Me This Setup" and §23 "What If?" — both grounded in the setup
 * currently on screen, never in generic theory. The source of every answer is
 * labelled so the user knows whether a language model wrote it (§70).
 */
export function AiPanel({
  setup,
  level,
  mode,
}: {
  setup: Setup;
  level: ExplanationLevel;
  mode: CoachMode;
}) {
  const t = useT("coach");
  const tt = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();

  const [tab, setTab] = useState<Intent>("teach");
  const [scenario, setScenario] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [answer, setAnswer] = useState<{ content: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (intent: Intent, input?: string) => {
      setLoading(true);
      setError(null);
      setAnswer(null);
      try {
        const result = await askAi({
          intent,
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          setupId: setup.id,
          locale,
          level,
          mode,
          input,
        });
        setAnswer(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "request failed");
      } finally {
        setLoading(false);
      }
    },
    [setup.symbol, setup.timeframe, setup.id, locale, level, mode],
  );

  const tabs: { key: Intent; label: string }[] = [
    { key: "teach", label: tt("explain.teachMe") },
    { key: "whatif", label: tt("explain.whatIf") },
    { key: "grade", label: t("grade.title") },
  ];

  return (
    <section className="card p-4">
      <SectionTitle title={t("title")} subtitle={t("subtitle")} />

      <div className="scroll-x -mx-1 mb-3 flex gap-1.5 px-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tab === item.key}
            onClick={() => {
              setTab(item.key);
              setAnswer(null);
              setError(null);
            }}
            className={cx(
              "h-9 shrink-0 rounded-md border px-3 text-[12px] font-medium",
              tab === item.key
                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-faint)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "teach" ? (
        <div>
          <p className="mb-2.5 text-[12px] leading-relaxed text-[var(--color-faint)]">
            {t("teach.subtitle")}
          </p>
          <button
            type="button"
            onClick={() => run("teach")}
            disabled={loading}
            className="tap w-full rounded-lg bg-[var(--color-surface-3)] px-4 text-[13px] font-medium text-[var(--color-text)] disabled:opacity-50"
          >
            {loading ? t("chat.thinking") : tt("explain.teachMe")}
          </button>
        </div>
      ) : null}

      {tab === "whatif" ? (
        <div className="space-y-2.5">
          <p className="text-[12px] leading-relaxed text-[var(--color-faint)]">{t("whatIf.subtitle")}</p>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            placeholder={tt("explain.whatIfPlaceholder")}
            rows={3}
            className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
          />
          <button
            type="button"
            onClick={() => run("whatif", scenario)}
            disabled={loading || scenario.trim().length === 0}
            className="tap w-full rounded-lg bg-[var(--color-surface-3)] px-4 text-[13px] font-medium disabled:opacity-50"
          >
            {loading ? t("chat.thinking") : t("whatIf.run")}
          </button>
          <p className="text-[11px] text-[var(--color-faint)]">{t("whatIf.note")}</p>
        </div>
      ) : null}

      {tab === "grade" ? (
        <div className="space-y-2.5">
          <p className="text-[12px] leading-relaxed text-[var(--color-faint)]">{t("grade.subtitle")}</p>
          <textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            placeholder={t("grade.placeholder")}
            rows={4}
            className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
          />
          <button
            type="button"
            onClick={() => run("grade", analysis)}
            disabled={loading || analysis.trim().length === 0}
            className="tap w-full rounded-lg bg-[var(--color-surface-3)] px-4 text-[13px] font-medium disabled:opacity-50"
          >
            {loading ? t("chat.thinking") : t("grade.submit")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] text-[var(--color-short)]">
          {tc("state.error")}: {error}
        </p>
      ) : null}

      {answer ? (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <Badge
            glyph={answer.source === "llm" ? "✦" : "="}
            className="mb-2.5 border-[var(--color-border)] text-[var(--color-faint)]"
          >
            {answer.source === "llm" ? t("chat.sourceLlm") : t("chat.sourceDeterministic")}
          </Badge>
          <AiText text={answer.content} />
        </div>
      ) : null}
    </section>
  );
}
