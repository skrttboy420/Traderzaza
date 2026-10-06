"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { breakEvenDecision, resultR } from "@atc/engine";
import { DEFAULT_WATCHLIST, getAsset } from "@atc/market-data";
import { TIMEFRAMES, type Timeframe } from "@atc/types";

import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, Disclaimer, Empty, Row, SectionTitle, Stat, cx } from "@/components/ui";
import { directionVisual } from "@/components/visual";
import { useLocale, usePhrase, useT } from "@/i18n/provider";
import { formatPrice, formatR, formatTime, timeframeLabel } from "@/lib/format";
import { symbolHref } from "@/lib/setup";
import { emptyEntry, useJournal, type JournalEntry } from "@/lib/store";

interface Quote {
  price: number;
  atr: number;
  protectedLevel: number | null;
}

/**
 * §27 trade management and §26 the break-even engine.
 *
 * This screen is a MANUAL position tracker. It is not wired to a broker and it
 * never sends an order — the user executes at their own broker and records the
 * fill here. That was not obvious from the old version of this page, so it is
 * now stated at the top before anything else.
 *
 * The break-even suggestion is not "+N points". It asks the engine, which only
 * agrees to move the stop once the trade has paid for itself AND a new swing
 * exists that would actually protect it.
 */
export default function PositionsPage() {
  const t = useT("journal");
  const tt = useT("trading");
  const tc = useT("common");
  const say = usePhrase();
  const { locale } = useLocale();
  const { open, closed, save, loaded } = useJournal();

  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [adding, setAdding] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  /** Position id currently showing the custom-exit input. */
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeInput, setCloseInput] = useState("");

  const symbols = useMemo(() => Array.from(new Set(open.map((p) => p.symbol))), [open]);

  // Current price and the latest protected swing come from the same engine
  // endpoint the rest of the app uses, so management advice matches the chart.
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const response = await fetch(
              `/api/analysis?symbol=${encodeURIComponent(symbol)}&timeframe=15m`,
            );
            if (!response.ok) return null;
            const data = (await response.json()) as {
              price: number;
              atr: number;
              structures?: {
                timeframe: string;
                lastSwingHigh?: { price: number } | null;
                lastSwingLow?: { price: number } | null;
              }[];
            };
            const entry = data.structures?.find((s) => s.timeframe === "15m");
            return [
              symbol,
              {
                price: data.price,
                atr: data.atr,
                protectedLevel: entry?.lastSwingLow?.price ?? null,
              },
            ] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      const next: Record<string, Quote> = {};
      for (const entry of entries) {
        if (!entry) continue;
        const [symbol, quote] = entry;
        next[symbol] = quote;
      }
      setQuotes(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const closePosition = useCallback(
    (entry: JournalEntry, exitPrice: number) => {
      const closedAt = Math.floor(Date.now() / 1000);
      const r = resultR({
        direction: entry.direction,
        entryPrice: entry.entryPrice,
        stopLoss: entry.stopLoss,
        exitPrice,
      });
      save({ ...entry, exitPrice, closedAt, resultR: r });
      setClosingId(null);
      setCloseInput("");
    },
    [save],
  );

  const list = tab === "open" ? open : closed;
  const formSymbols = useMemo(
    () => Array.from(new Set([...DEFAULT_WATCHLIST, ...symbols])),
    [symbols],
  );

  return (
    <>
      <TopBar title={t("positions.title")} />

      <main className="space-y-4 p-4">
        {/* ------------------------------------------------------------------ */}
        {/*  What this screen is. First thing on the page, deliberately.        */}
        {/* ------------------------------------------------------------------ */}
        <section className="card p-4">
          <SectionTitle
            title={t("positions.howItWorks")}
            right={
              <Badge
                glyph="⚠"
                className="border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]"
              >
                {t("positions.notConnected")}
              </Badge>
            }
          />
          <p className="text-[12.5px] leading-relaxed text-[var(--color-text)]/85">
            {t("positions.howItWorksBody")}
          </p>

          <ol className="mt-3 space-y-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                <span
                  aria-hidden
                  className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[10.5px] text-[var(--color-muted)]"
                >
                  {n}
                </span>
                <span className="min-w-0 text-[var(--color-text)]/85">
                  {t(`positions.step${n}`)}
                </span>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => setHowOpen((v) => !v)}
            aria-expanded={howOpen}
            className="mt-3 text-[11.5px] font-medium text-[var(--color-muted)] underline decoration-dotted underline-offset-4"
          >
            {t("positions.whyManual")}
          </button>
          {howOpen ? (
            <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
              {t("positions.whyManualBody")}
            </p>
          ) : null}
        </section>

        {/* ------------------------------------------------------------------ */}
        {/*  Open a position — the flow that was missing entirely.             */}
        {/* ------------------------------------------------------------------ */}
        {adding ? (
          <OpenPositionForm
            symbols={formSymbols}
            onSave={(entry) => {
              save(entry);
              setAdding(false);
              setTab("open");
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="tap w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[13px] font-semibold"
          >
            + {t("positions.openNew")}
          </button>
        )}

        <div className="flex gap-1.5">
          {(["open", "closed"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={cx(
                "h-9 rounded-md border px-3 text-[12px] font-medium",
                tab === key
                  ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                  : "border-[var(--color-border)] text-[var(--color-faint)]",
              )}
            >
              {t(`positions.${key}`)}{" "}
              <span className="num">{key === "open" ? open.length : closed.length}</span>
            </button>
          ))}
        </div>

        {!loaded ? (
          <p className="text-[12.5px] text-[var(--color-faint)]">{tc("state.loading")}</p>
        ) : list.length === 0 ? (
          <Empty title={t("positions.empty")} hint={t("positions.openNewHint")} />
        ) : (
          <ul className="space-y-2.5">
            {list.map((entry) => {
              const asset = getAsset(entry.symbol);
              const dir = directionVisual(entry.direction);
              const quote = quotes[entry.symbol];
              const live = quote?.price ?? null;
              const isOpen = entry.closedAt === null;
              const target = entry.takeProfits[0] ?? null;

              const openR =
                live !== null
                  ? resultR({
                      direction: entry.direction,
                      entryPrice: entry.entryPrice,
                      stopLoss: entry.stopLoss,
                      exitPrice: live,
                    })
                  : null;

              const be =
                isOpen && live !== null && quote
                  ? breakEvenDecision({
                      direction: entry.direction,
                      entryPrice: entry.entryPrice,
                      stopLoss: entry.stopLoss,
                      currentPrice: live,
                      newProtectedLevel: quote.protectedLevel,
                      atrValue: quote.atr,
                    })
                  : null;

              const toStop = live !== null ? Math.abs(live - entry.stopLoss) : null;
              const toTarget = live !== null && target !== null ? Math.abs(target - live) : null;

              return (
                <li key={entry.id} className="card p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={symbolHref(entry.symbol)}
                        className="truncate text-[15px] font-semibold tracking-tight"
                      >
                        {entry.symbol}
                      </Link>
                      <span className="num shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-muted)]">
                        {timeframeLabel(entry.timeframe)}
                      </span>
                      <Badge glyph={dir.glyph} className={cx(dir.text, dir.bg, dir.border)}>
                        {tt(`direction.${entry.direction}`)}
                      </Badge>
                    </div>
                    <span
                      className={cx(
                        "num shrink-0 text-[15px] font-semibold",
                        (entry.resultR ?? openR ?? 0) > 0
                          ? "text-[var(--color-long)]"
                          : (entry.resultR ?? openR ?? 0) < 0
                            ? "text-[var(--color-short)]"
                            : "text-[var(--color-muted)]",
                      )}
                    >
                      {formatR(entry.resultR ?? openR)}
                    </span>
                  </div>

                  <div className="mt-2.5 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-1">
                    <Row label={t("positions.entry")} value={formatPrice(entry.entryPrice, asset)} />
                    <Row
                      label={tt("plan.stopLoss")}
                      value={formatPrice(entry.stopLoss, asset)}
                      tone="text-[var(--color-short)]"
                    />
                    {target !== null ? (
                      <Row
                        label={t("form.target")}
                        value={formatPrice(target, asset)}
                        tone="text-[var(--color-long)]"
                      />
                    ) : null}
                    {live !== null && isOpen ? (
                      <Row label={t("positions.current")} value={formatPrice(live, asset)} />
                    ) : null}
                    {isOpen && toStop !== null ? (
                      <Row
                        label={t("positions.distanceToStop")}
                        value={formatPrice(toStop, asset)}
                      />
                    ) : null}
                    {isOpen && toTarget !== null ? (
                      <Row
                        label={t("positions.distanceToTarget")}
                        value={formatPrice(toTarget, asset)}
                      />
                    ) : null}
                    {entry.exitPrice !== null ? (
                      <Row label={t("form.exit")} value={formatPrice(entry.exitPrice, asset)} />
                    ) : null}
                    <Row label={t("positions.openedAt")} value={formatTime(entry.openedAt, locale)} />
                    {entry.closedAt !== null ? (
                      <Row
                        label={t("positions.closedAt")}
                        value={formatTime(entry.closedAt, locale)}
                      />
                    ) : null}
                  </div>

                  {isOpen && live === null ? (
                    <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                      {t("positions.noQuote")}
                    </p>
                  ) : null}

                  {entry.setupId === null ? (
                    <p className="mt-2.5 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-wait)]">
                      {t("form.noSetupWarning")}
                    </p>
                  ) : null}

                  {be ? (
                    <div className="mt-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                      <p className="mb-1 text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("positions.manage")}
                      </p>
                      <p
                        className={cx(
                          "text-[12px] leading-relaxed",
                          be.move ? "text-[var(--color-long)]" : "text-[var(--color-muted)]",
                        )}
                      >
                        <span aria-hidden className="mr-1">
                          {be.move ? "✓" : "–"}
                        </span>
                        {say(be.reason)}
                        {be.price !== null ? ` (${formatPrice(be.price, asset)})` : ""}
                      </p>
                    </div>
                  ) : null}

                  {isOpen ? (
                    closingId === entry.id ? (
                      <div className="mt-2.5 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                        <label className="block">
                          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                            {t("positions.closeAt")}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step={asset?.minTick ?? 0.01}
                            value={closeInput}
                            onChange={(e) => setCloseInput(e.target.value)}
                            autoFocus
                            className="num h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={!Number.isFinite(Number(closeInput)) || closeInput === ""}
                            onClick={() => closePosition(entry, Number(closeInput))}
                            className="tap flex-1 rounded-lg bg-[var(--color-surface-3)] text-[12.5px] font-semibold disabled:opacity-40"
                          >
                            {t("positions.closeTrade")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setClosingId(null);
                              setCloseInput("");
                            }}
                            className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
                          >
                            {tc("actions.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2.5 flex gap-2">
                        {live !== null ? (
                          <button
                            type="button"
                            onClick={() => closePosition(entry, live)}
                            className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
                          >
                            {t("positions.closeAtMarket")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setClosingId(entry.id);
                            setCloseInput(live !== null ? String(live) : "");
                          }}
                          className="tap flex-1 rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
                        >
                          {t("positions.closeCustom")}
                        </button>
                      </div>
                    )
                  ) : null}

                  {entry.notes ? (
                    <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
                      <Bullets items={[entry.notes]} glyph="✎" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="px-1 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          {t("positions.liveNote")}
        </p>

        <section className="card p-4">
          <SectionTitle title={t("storage.local")} subtitle={t("storage.localHint")} />
          <div className="grid grid-cols-2 gap-4">
            <Stat label={t("positions.open")} value={open.length} />
            <Stat label={t("positions.closed")} value={closed.length} />
          </div>
          <Link
            href="/journal"
            className="tap mt-3 flex w-full items-center justify-center rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
          >
            {t("positions.goJournal")} →
          </Link>
        </section>

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Open a position                                                           */
/* -------------------------------------------------------------------------- */

interface PrefillPlan {
  price: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  direction: "long" | "short" | null;
  setupId: string | null;
}

/**
 * The minimal form for recording a fill. Deliberately smaller than JournalForm:
 * classification, feeling and plan-adherence are review fields that belong to
 * the journal AFTER the trade is closed, not to the moment of entry.
 *
 * "Prefill from setup" fills entry/stop/target from the engine's own plan so a
 * user following the Setups screen does not have to retype four numbers — but
 * the values stay editable, because the price you actually got is the only one
 * worth recording.
 */
function OpenPositionForm({
  symbols,
  onSave,
  onCancel,
}: {
  symbols: string[];
  onSave: (entry: JournalEntry) => void;
  onCancel: () => void;
}) {
  const t = useT("journal");
  const tt = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();

  const [entry, setEntry] = useState<JournalEntry>(() =>
    emptyEntry(symbols[0] ?? "XAUUSD", locale),
  );
  const [target, setTarget] = useState("");
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [planError, setPlanError] = useState(false);

  const set = <K extends keyof JournalEntry>(key: K, value: JournalEntry[K]) =>
    setEntry((prev) => ({ ...prev, [key]: value }));

  const asset = getAsset(entry.symbol);
  const step = asset?.minTick ?? 0.01;

  const prefill = useCallback(async () => {
    setLoadingPlan(true);
    setPlanError(false);
    try {
      const response = await fetch(
        `/api/analysis?symbol=${encodeURIComponent(entry.symbol)}&timeframe=${entry.timeframe}`,
      );
      if (!response.ok) throw new Error("analysis failed");
      const data = (await response.json()) as {
        price: number;
        best?: {
          id: string;
          direction: string;
          plans?: { bestPrice: number; stopLoss: number; takeProfits?: { price: number }[] }[];
        } | null;
      };

      const best = data.best ?? null;
      const plan = best?.plans?.[0] ?? null;
      const direction =
        best?.direction === "long" || best?.direction === "short" ? best.direction : null;

      const next: PrefillPlan = {
        price: data.price,
        entryPrice: plan?.bestPrice ?? data.price,
        stopLoss: plan?.stopLoss ?? 0,
        takeProfit: plan?.takeProfits?.[0]?.price ?? null,
        direction,
        setupId: best?.id ?? null,
      };

      setEntry((prev) => ({
        ...prev,
        direction: next.direction ?? prev.direction,
        entryPrice: next.entryPrice,
        stopLoss: next.stopLoss || prev.stopLoss,
        setupId: next.setupId,
      }));
      setTarget(next.takeProfit !== null ? String(next.takeProfit) : "");
      setPrefilled(true);
    } catch {
      setPlanError(true);
    } finally {
      setLoadingPlan(false);
    }
  }, [entry.symbol, entry.timeframe]);

  const valid = entry.entryPrice > 0 && entry.stopLoss > 0 && entry.stopLoss !== entry.entryPrice;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const tp = Number(target);
        const now = Math.floor(Date.now() / 1000);
        onSave({
          ...entry,
          takeProfits: Number.isFinite(tp) && tp > 0 ? [tp] : [],
          openedAt: now,
          createdAt: now,
          language: locale,
        });
      }}
      className="card space-y-3 p-4"
    >
      <SectionTitle title={t("positions.openNew")} subtitle={t("positions.openNewHint")} />

      <button
        type="button"
        onClick={prefill}
        disabled={loadingPlan}
        className="tap w-full rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)] disabled:opacity-50"
      >
        {loadingPlan ? tc("state.loading") : t("positions.prefillFromSetup")}
      </button>

      {prefilled ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
          {t("positions.prefilled")}
        </p>
      ) : null}
      {planError ? (
        <p className="text-[11.5px] leading-relaxed text-[var(--color-wait)]">
          {tc("state.error")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.symbol")}>
          <select
            value={entry.symbol}
            onChange={(e) => {
              set("symbol", e.target.value);
              setPrefilled(false);
            }}
            className="field"
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
            className="field"
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
            className="field num"
          />
        </Field>

        <Field label={t("form.entry")}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={entry.entryPrice || ""}
            onChange={(e) => set("entryPrice", Number(e.target.value))}
            className="field num"
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
            className="field num"
            required
          />
        </Field>

        <Field label={t("form.target")}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="field num"
          />
        </Field>
      </div>

      <Field label={t("form.note")}>
        <textarea
          value={entry.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("form.notePlaceholder")}
          rows={3}
          className="field resize-y py-2 leading-relaxed"
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="tap flex-1 rounded-lg bg-[var(--color-surface-3)] text-[13px] font-semibold disabled:opacity-40"
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
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
