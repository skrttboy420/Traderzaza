"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { detectPatterns, weeklyReport } from "@atc/engine";
import { TIMEFRAMES, type ExplanationLevel, type Timeframe } from "@atc/types";

import { AiText } from "@/components/AiPanel";
import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, Disclaimer, SectionTitle, Stat, cx } from "@/components/ui";
import { useLocale, useT } from "@/i18n/provider";
import { GLOSSARY, glossaryText, searchGlossary } from "@/lib/glossary";
import { useJournal, useSettings } from "@/lib/store";
import type { CoachMode } from "@/lib/settings";

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** "llm" when a language model wrote it, otherwise the deterministic engine. */
  source?: string;
  /** Why the model did not answer, when a key was configured but the call failed. */
  note?: string;
}

const LEVELS: ExplanationLevel[] = ["beginner", "intermediate", "advanced"];
const MODES: CoachMode[] = ["coach", "direct"];
const SUGGESTIONS = ["why", "wait", "stop", "invalid", "mtf"] as const;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * §36-37 Coach Mode, §66-67 glossary and levels, §42/§68 psychology with
 * journal evidence, §72 AI performance transparency.
 *
 * Every answer is grounded server-side in a freshly analysed symbol, which is
 * why the market selector matters: without it the coach would be talking about
 * nothing, and it says so (chat.noContext) rather than inventing a chart.
 */
export default function CoachPage() {
  const t = useT("coach");
  const tt = useT("trading");
  const tc = useT("common");
  const tj = useT("journal");
  const { locale } = useLocale();

  const { settings, patch } = useSettings();
  const { entries } = useJournal();

  const [symbol, setSymbol] = useState<string>(settings.watchlist[0] ?? "XAUUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>(settings.entryTimeframe);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || loading) return;

      const history: Turn[] = [...turns, { role: "user", content: question }];
      setTurns(history);
      setDraft("");
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: "chat",
            symbol,
            timeframe,
            locale,
            level: settings.explanationLevel,
            mode: settings.coachMode,
            messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
            // §68: behaviour claims are only allowed with journal evidence, so
            // the journal travels with the question.
            trades: entries,
          }),
        });
        const payload = (await response.json()) as {
          content?: string;
          source?: string;
          note?: string | null;
          error?: string;
        };
        if (!response.ok || !payload.content) throw new Error(payload.error ?? "request failed");
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.content ?? "",
            source: payload.source ?? "deterministic",
            ...(payload.note ? { note: payload.note } : {}),
          },
        ]);
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (node) node.scrollTo({ top: node.scrollHeight });
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "request failed");
      } finally {
        setLoading(false);
      }
    },
    [turns, loading, symbol, timeframe, locale, settings.explanationLevel, settings.coachMode, entries],
  );

  // §42/§68: patterns come from the journal only. No journal, no claims.
  const now = Math.floor(Date.now() / 1000);
  const patterns = useMemo(
    () => detectPatterns({ trades: entries, from: 0, to: now + 60 }),
    [entries, now],
  );
  const week = useMemo(
    () => weeklyReport({ trades: entries, from: now - WEEK_SECONDS, to: now + 60 }),
    [entries, now],
  );

  const results = useMemo(() => searchGlossary(query, locale), [query, locale]);

  // §72: be transparent that per-grade calibration needs persisted history we
  // do not have in local-only mode, instead of showing a fabricated number.
  const linkedToSetup = entries.filter((e) => e.setupId !== null).length;

  return (
    <>
      <TopBar title={t("title")} />

      <main className="space-y-4 p-4">
        <SectionTitle title={t("title")} subtitle={t("subtitle")} />

        {/* ---------- what we are talking about ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("chat.contextLabel")} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {tj("form.symbol")}
              </span>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
              >
                {settings.watchlist.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {tt("chart.timeframe")}
              </span>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none focus:border-[var(--color-border-strong)]"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* §36 coach vs direct, §67 explanation level */}
          <div className="mt-3.5 space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("mode.label")}
              </p>
              <div className="flex gap-1.5">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={settings.coachMode === mode}
                    onClick={() => patch({ coachMode: mode })}
                    className={cx(
                      "tap flex-1 rounded-lg border px-2 text-[12.5px] font-medium",
                      settings.coachMode === mode
                        ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                        : "border-[var(--color-border)] text-[var(--color-faint)]",
                    )}
                  >
                    {t(`mode.${mode}`)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {t(settings.coachMode === "coach" ? "mode.coachHint" : "mode.directHint")}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {t("level.label")}
              </p>
              <div className="flex gap-1.5">
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={settings.explanationLevel === level}
                    onClick={() => patch({ explanationLevel: level })}
                    className={cx(
                      "tap flex-1 rounded-lg border px-2 text-[12.5px] font-medium",
                      settings.explanationLevel === level
                        ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                        : "border-[var(--color-border)] text-[var(--color-faint)]",
                    )}
                  >
                    {t(`level.${level}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- the conversation ---------- */}
        <section className="card p-4">
          <div ref={scrollRef} className="max-h-[60vh] space-y-3 overflow-y-auto">
            {turns.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-[var(--color-faint)]">
                {t("chat.empty")}
              </p>
            ) : (
              turns.map((turn, i) =>
                turn.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-lg rounded-br-sm bg-[var(--color-surface-3)] px-3 py-2 text-[13px] leading-relaxed">
                      {turn.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                    <Badge
                      glyph={turn.source === "llm" ? "✦" : "="}
                      className="mb-2 border-[var(--color-border)] text-[var(--color-faint)]"
                    >
                      {turn.source === "llm" ? t("chat.sourceLlm") : t("chat.sourceDeterministic")}
                    </Badge>
                    <AiText text={turn.content} />
                    {/* Only appears when a key is set and the call still
                        failed — the one state the badge above cannot explain,
                        and the state someone is in right after pasting a key
                        that is mistyped or out of credit. */}
                    {turn.note ? (
                      <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                        {t("chat.fallbackReason")}: <span className="num">{turn.note}</span>
                      </p>
                    ) : null}
                  </div>
                ),
              )
            )}
            {loading ? (
              <p className="text-[12.5px] text-[var(--color-faint)]">{t("chat.thinking")}</p>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-short)]">
              {tc("state.error")}: {error}
            </p>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
            className="mt-3 flex gap-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("chat.placeholder")}
              className="tap min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
            />
            <button
              type="submit"
              disabled={loading || draft.trim().length === 0}
              className="tap shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] px-4 text-[12.5px] font-semibold disabled:opacity-50"
            >
              {tc("actions.send")}
            </button>
          </form>

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("suggest.label")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={loading}
                  onClick={() => void ask(t(`suggest.${key}`))}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-[var(--color-muted)] disabled:opacity-50"
                >
                  {t(`suggest.${key}`)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- psychology, evidence-only (§42, §68) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("psychology.title")} subtitle={t("psychology.subtitle")} />

          {patterns.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              {t("psychology.noPatterns")}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {patterns.map((pattern) => (
                <li
                  key={pattern.tag}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium">
                      {t(`psychology.tag.${pattern.tag}`)}
                    </p>
                    <span className="num shrink-0 text-[12px] text-[var(--color-short)]">
                      {pattern.occurrences}× · {pattern.costR}R
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                    {t("memory.evidence")}
                  </p>
                  <Bullets items={pattern.evidence.slice(0, 4)} glyph="=" />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3.5 border-t border-[var(--color-border)] pt-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("psychology.weekly")}
            </p>
            <Bullets items={week.facts} glyph="=" />
          </div>
        </section>

        {/* ---------- coach memory (§68) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("memory.title")} subtitle={t("memory.subtitle")} />
          {entries.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-[var(--color-faint)]">
              {t("memory.empty")}
            </p>
          ) : (
            <p className="text-[12.5px] text-[var(--color-muted)]">
              {t("memory.basedOnTrades", { count: entries.length })}
            </p>
          )}
        </section>

        {/* ---------- AI performance (§72) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("aiPerf.title")} subtitle={t("aiPerf.subtitle")} />
          <div className="grid grid-cols-2 gap-4">
            <Stat label={t("aiPerf.samples")} value={linkedToSetup} />
            <Stat label={tj("metrics.trades")} value={entries.length} />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
            {t("aiPerf.notEnough")}
          </p>
        </section>

        {/* ---------- glossary (§66) ---------- */}
        <section className="card p-4">
          <SectionTitle title={t("glossary.title")} subtitle={t("glossary.subtitle")} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("glossary.search")}
            className="tap w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
          />

          {results.length === 0 ? (
            <p className="mt-3 text-[12px] text-[var(--color-faint)]">{t("glossary.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {results.map((item) => (
                <li key={item.term} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold">{item.term}</p>
                    <span className="shrink-0 text-[10.5px] text-[var(--color-faint)]">
                      {t(`level.${item.level}`)}
                    </span>
                  </div>
                  {item.expands ? (
                    <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">{item.expands}</p>
                  ) : null}
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
                    {glossaryText(item, locale)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[11px] text-[var(--color-faint)]">
            {results.length} / {GLOSSARY.length}
          </p>
        </section>

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
