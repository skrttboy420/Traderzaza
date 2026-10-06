"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Candle, EntryPlan, Setup, StructureReading, SupplyDemandZone } from "@atc/types";

import type { ChartLayers } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { CHART_COLORS, readChartColors, type ChartColors } from "./visual";

export interface PriceChartProps {
  candles: Candle[];
  zones: SupplyDemandZone[];
  structure: StructureReading | null;
  setup: Setup | null;
  plan: EntryPlan | null;
  layers: ChartLayers;
  minTick: number;
  height?: number;
}

/**
 * TradingView Lightweight Charts v5.
 *
 * §55: every overlay is a toggleable layer.
 * §57: an invalidated setup's levels are drawn in grey instead of being
 * removed, so the user can still study what went wrong.
 */
export function PriceChart({
  candles,
  zones,
  structure,
  setup,
  plan,
  layers,
  minTick,
  height = 340,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  /**
   * The canvas cannot inherit the theme, so the palette is resolved from the
   * container's computed style and kept in a ref.
   *
   * A ref rather than state because this is not render input — nothing in the
   * JSX below depends on a colour — and making it state would mean an extra
   * render of the whole chart subtree on every theme switch for no benefit.
   * `theme` from the context is what actually drives re-resolution.
   */
  const { theme } = useTheme();
  const colorsRef = useRef<ChartColors>({ ...CHART_COLORS });

  // Create the chart once; data and overlays are updated in separate effects so
  // toggling a layer never rebuilds the canvas (and never loses the user's zoom).
  // The theme is deliberately not a dependency here for the same reason: the
  // effect below recolours the existing chart in place.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = readChartColors(container);
    colorsRef.current = colors;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => p.toFixed(decimalsFor(minTick)) },
      autoSize: true,
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: "price", precision: decimalsFor(minTick), minMove: minTick },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    return () => {
      markersRef.current = null;
      linesRef.current = [];
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [minTick]);

  /**
   * Recolour on a theme switch, in place.
   *
   * Declared before the overlay effects on purpose: effects run in declaration
   * order, so by the time the price-line and marker effects re-run for the
   * same `theme` change, `colorsRef` already holds the new palette. The
   * background, grid and candles are applied here; the overlays redraw
   * themselves because they list `theme` as a dependency.
   */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const colors = readChartColors(containerRef.current);
    colorsRef.current = colors;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid },
    });
    series.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
  }, [theme]);

  // Candles.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    // On a daily chart every candle opens at the same clock time, so showing it
    // would label the whole axis "00:00". Read the spacing off the data instead
    // of taking a timeframe prop, so the replay screen gets this for free.
    chartRef.current?.timeScale().applyOptions({ timeVisible: candleSpacing(candles) < 86400 });
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Price lines: zone edges, entry, stop, targets.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];

    const colors = colorsRef.current;
    const dead = setup?.status === "INVALIDATED";
    const add = (price: number, color: string, title: string, style: LineStyle) => {
      if (!Number.isFinite(price) || price <= 0) return;
      linesRef.current.push(
        series.createPriceLine({
          price,
          color: dead ? colors.invalid : color,
          lineWidth: 1,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        }),
      );
    };

    if (layers.zones) {
      for (const zone of zones.slice(0, 4)) {
        const color = zone.kind === "demand" ? colors.demandLine : colors.supplyLine;
        const tag = `${zone.kind === "demand" ? "D" : "S"} ${zone.timeframe}`;
        const style = zone.invalidated ? LineStyle.Dotted : LineStyle.Solid;
        add(zone.top, zone.invalidated ? colors.invalid : color, `${tag} top`, style);
        add(zone.bottom, zone.invalidated ? colors.invalid : color, `${tag} bottom`, style);
      }
    }

    if (layers.entries && plan) {
      add(plan.bestPrice, colors.entry, "Best", LineStyle.Dashed);
      add(plan.saferPrice, colors.entry, "Safer", LineStyle.Dotted);
      add(plan.stopLoss, colors.stop, "SL", LineStyle.Solid);
      plan.takeProfits.forEach((tp, i) => {
        add(tp.price, colors.target, `TP${i + 1}`, LineStyle.Dashed);
      });
    }
    // `theme` is a dependency because a price line's colour is baked in at
    // creation — lightweight-charts has no recolour-in-place for these, so the
    // lines have to be torn down and rebuilt when the palette changes.
  }, [zones, plan, setup, layers.zones, layers.entries, theme]);

  // Markers: swing labels and structure events.
  useEffect(() => {
    const markerApi = markersRef.current;
    if (!markerApi) return;

    const colors = colorsRef.current;
    const markers: SeriesMarker<Time>[] = [];

    if (layers.swings && structure) {
      for (const swing of structure.swings) {
        if (!swing.label) continue;
        markers.push({
          time: swing.time as UTCTimestamp,
          position: swing.kind === "high" ? "aboveBar" : "belowBar",
          color: colors.swing,
          shape: swing.kind === "high" ? "arrowDown" : "arrowUp",
          text: swing.label,
          size: 0,
        });
      }
    }

    if (layers.structure && structure) {
      for (const event of structure.events) {
        markers.push({
          time: event.time as UTCTimestamp,
          position: event.direction === "bullish" ? "belowBar" : "aboveBar",
          color: event.direction === "bullish" ? colors.up : colors.down,
          shape: "circle",
          text: event.type,
          size: 1,
        });
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markerApi.setMarkers(markers);
  }, [structure, layers.swings, layers.structure, theme]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

/**
 * Seconds between candles, as the smallest gap in the series.
 *
 * The minimum rather than the mean or the median, because every real feed has
 * gaps — weekends on FX, session breaks, missing bars — and any averaging
 * statistic gets dragged above the true interval by them. The smallest gap
 * between two adjacent candles is the interval itself.
 */
function candleSpacing(candles: Candle[]): number {
  let smallest = Infinity;
  for (let i = 1; i < candles.length; i += 1) {
    const gap = (candles[i]?.time ?? 0) - (candles[i - 1]?.time ?? 0);
    if (gap > 0 && gap < smallest) smallest = gap;
  }
  // One candle (or none) tells us nothing; assume intraday, which is the
  // common case and matches the previous hardcoded behaviour.
  return Number.isFinite(smallest) ? smallest : 0;
}

function decimalsFor(minTick: number): number {
  if (!Number.isFinite(minTick) || minTick <= 0) return 2;
  const text = minTick.toExponential();
  const exponent = Number(text.slice(text.indexOf("e") + 1));
  return Math.max(0, -exponent);
}
