"use client";

import { useMemo, useState } from "react";
import type {
  Asset,
  Candle,
  MarketRegime,
  MtfAlignment,
  Phrase,
  PullbackReading,
  Setup,
  StructureReading,
  SupplyDemandZone,
  Timeframe,
  DataStatus,
} from "@atc/types";
import { TIMEFRAMES } from "@atc/types";

import { AiPanel } from "@/components/AiPanel";
import { ChartLayerToggle, TimeframeToggle } from "@/components/ChartLayerToggle";
import { DataStatusBadge, DataStatusPanel } from "@/components/DataStatusBadge";
import { FactBlock, ReasoningBlock } from "@/components/FactBlock";
import { NewsPanel } from "@/components/NewsPanel";
import { PlansPanel } from "@/components/PlansPanel";
import { PriceChart } from "@/components/PriceChart";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { TopBar } from "@/components/TopBar";
import {
  LifecycleRail,
  MarketHeader,
  MtfPanel,
  NoTradePanel,
  PullbackPanel,
  ZonePanel,
} from "@/components/ContextPanels";
import { Badge, Disclaimer, SectionTitle, cx } from "@/components/ui";
import { SCANNER_VISUAL, directionVisual } from "@/components/visual";
import { useT } from "@/i18n/provider";
import { timeframeLabel } from "@/lib/format";
import { primaryPlan } from "@/lib/setup";
import { useSettings } from "@/lib/store";

export interface SetupDetailData {
  symbol: string;
  asset: Asset;
  entryTimeframe: Timeframe;
  price: number;
  regime: MarketRegime;
  pullback: PullbackReading;
  mtf: MtfAlignment;
  setups: Setup[];
  zones: SupplyDemandZone[];
  structures: StructureReading[];
  candles: Partial<Record<Timeframe, Candle[]>>;
  dataStatus: DataStatus;
  noTradeReasons: Phrase[];
  initialSetupId: string | null;
}

/**
 * §59 setup detail order: chart first, then state, then quality with its
 * breakdown, then the reasoning, then the plans, then the raw context, and
 * finally the explainable-AI blocks. Nothing is hidden behind a tooltip.
 */
export function SetupDetailView({ data }: { data: SetupDetailData }) {
  const t = useT("trading");
  const tc = useT("common");
  const { settings, patch } = useSettings();

  const [selectedId, setSelectedId] = useState<string | null>(
    data.initialSetupId ?? data.setups[0]?.id ?? null,
  );
  const [chartTf, setChartTf] = useState<Timeframe>(data.entryTimeframe);
  const [planId, setPlanId] = useState<string | undefined>(undefined);

  const setup = useMemo(
    () => data.setups.find((s) => s.id === selectedId) ?? data.setups[0] ?? null,
    [data.setups, selectedId],
  );

  const plan = useMemo(() => {
    if (!setup) return null;
    return setup.plans.find((p) => p.id === planId) ?? primaryPlan(setup);
  }, [setup, planId]);

  const chartCandles = data.candles[chartTf] ?? [];
  const chartStructure = data.structures.find((s) => s.timeframe === chartTf) ?? null;
  const chartZones = useMemo(
    () => data.zones.filter((z) => z.timeframe === chartTf || z.id === setup?.zone?.id),
    [data.zones, chartTf, setup],
  );

  // Sorted by TIMEFRAMES, not by object key order. The loader inserts the
  // mandatory chain first (4h, 1h, 15m, 5m) and appends extras like 1d after,
  // so reading the keys directly would print the switcher backwards with the
  // daily stuck on the end.
  const availableTimeframes = useMemo(
    () => TIMEFRAMES.filter((tf) => (data.candles[tf]?.length ?? 0) > 0),
    [data.candles],
  );

  const scanner = setup ? SCANNER_VISUAL[setup.scannerState] : null;
  const dir = setup ? directionVisual(setup.direction) : null;

  const trendText = data.structures[0]
    ? `${timeframeLabel(data.structures[0].timeframe)} ${t(`trend.${data.structures[0].trend}`)}`
    : "";

  return (
    <>
      <TopBar title={data.symbol} subtitle={t("setups.title")} />

      <main className="space-y-4 p-4">
        <section className="space-y-2.5">
          <MarketHeader
            symbol={data.symbol}
            price={data.price}
            asset={data.asset}
            regime={t(`regime.${data.regime}`)}
            trendLabelText={trendText}
          />
          <DataStatusBadge status={data.dataStatus} compact />
          {setup ? <LifecycleRail setup={setup} /> : null}
        </section>

        {/* Chart */}
        <section className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
            <span className="text-[12px] font-medium text-[var(--color-muted)]">
              {t("chart.timeframe")}
            </span>
            <TimeframeToggle value={chartTf} options={availableTimeframes} onChange={setChartTf} />
          </div>

          <PriceChart
            candles={chartCandles}
            zones={chartZones}
            structure={chartStructure}
            setup={setup}
            plan={plan}
            layers={settings.chartLayers}
            minTick={data.asset.minTick}
          />

          <div className="border-t border-[var(--color-border)] p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              {t("chart.layers")}
            </p>
            <ChartLayerToggle
              layers={settings.chartLayers}
              onChange={(next) => patch({ chartLayers: next })}
            />
          </div>
        </section>

        {/* Which setup on this market */}
        {data.setups.length > 1 ? (
          <section>
            <SectionTitle title={t("setups.title")} subtitle={t("setups.invalidatedKept")} />
            <div className="scroll-x -mx-1 flex gap-1.5 px-1">
              {data.setups.map((s) => {
                const visual = SCANNER_VISUAL[s.scannerState];
                const active = s.id === setup?.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedId(s.id);
                      setPlanId(undefined);
                    }}
                    className={cx(
                      "flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-[12px]",
                      active
                        ? "border-[var(--color-border-strong)] bg-[var(--color-surface-3)]"
                        : "border-[var(--color-border)]",
                      s.status === "INVALIDATED" && "opacity-55",
                    )}
                  >
                    <span aria-hidden className={cx("text-[10px]", visual.text)}>
                      {visual.glyph}
                    </span>
                    <span className="font-medium">
                      {s.zone ? t(`zone.${s.zone.kind}`) : t("direction.none")}
                    </span>
                    <span className="num text-[var(--color-faint)]">{s.quality.score}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {setup && scanner && dir ? (
          <>
            <section className="card p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge glyph={dir.glyph} className={cx(dir.text, dir.bg, dir.border)}>
                  {t(`direction.${setup.direction}`)}
                </Badge>
                <Badge glyph={scanner.glyph} className={cx(scanner.text, scanner.bg, scanner.border)}>
                  {t(`scannerState.${setup.scannerState}`)}
                </Badge>
                <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
                  {t(`setupStatus.${setup.status}`)}
                </Badge>
                <Badge className="border-[var(--color-border)] text-[var(--color-muted)]">
                  {timeframeLabel(setup.timeframe)}
                </Badge>
              </div>
              {setup.status === "INVALIDATED" ? (
                <p className="mt-3 rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-short)]">
                  {t("setups.invalidatedKept")}
                </p>
              ) : null}
            </section>

            <ScoreBreakdown
              quality={setup.quality}
              aiConfidence={setup.aiConfidence}
              showConfidence={settings.showAiConfidence}
            />

            <ReasoningBlock
              whyEnter={setup.whyEnter}
              whyWait={setup.whyWait}
              confirmationRequired={setup.confirmationRequired}
              invalidation={setup.invalidation}
            />

            <PlansPanel
              plans={setup.plans}
              asset={data.asset}
              {...(planId ? { selected: planId } : {})}
              onSelect={setPlanId}
            />

            {data.noTradeReasons.length > 0 ? <NoTradePanel reasons={data.noTradeReasons} /> : null}

            {setup.zone ? <ZonePanel zone={setup.zone} asset={data.asset} /> : null}

            <MtfPanel mtf={setup.mtf} />
            <PullbackPanel pullback={setup.pullback} />

            <FactBlock
              facts={setup.facts}
              interpretation={setup.interpretation}
              assumptions={setup.assumptions}
            />

            <AiPanel setup={setup} level={settings.explanationLevel} mode={settings.coachMode} />
          </>
        ) : (
          <NoTradePanel reasons={data.noTradeReasons} />
        )}

        {/* News sits below the plan on purpose: it is a reason to wait or to
            widen a stop, not an entry signal, so it must not be the first
            thing read on the page. */}
        <NewsPanel symbol={data.asset.symbol} />

        <section className="card p-4">
          <SectionTitle title={tc("dataQuality.label")} />
          <DataStatusPanel status={data.dataStatus} />
        </section>

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
