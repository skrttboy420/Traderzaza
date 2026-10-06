# AI Trading Coach & Market Analysis Platform

A mobile-first trading terminal that **gives signals with the reasoning attached** — for a
Supply/Demand + market-structure + multi-timeframe pullback trader.

It tells you the direction, the entry, the stop and the targets. It also tells you what the
structure is doing, why those entries are valid and others are not, what confirmation is
still missing, where the idea dies, and what you should learn from it. Every number is
computed in code; the language model only turns the calculation into words. The signal is a
set of conditions that met the criteria — not a prediction, and not an order. **You place
the trade.**

> Educational and analytical tool. Not financial advice. No performance is guaranteed.

---

## 1. What is actually built

Eleven screens, all live and reachable from the bottom navigation:

| Screen | Path | What it does |
|---|---|---|
| **Home** | `/` | Proactive: opens straight onto "here are the best opportunities right now", market health, and what to do next. No question required. |
| **Markets** | `/markets` | Per-asset trend/phase/regime, data quality, MTF agreement. |
| **Setups** | `/setups` | The multi-asset scanner: Top Opportunities plus the five buckets (ENTRY_NOW, WAIT_CONFIRMATION, LIMIT_ZONE, WATCHLIST, NO_TRADE). |
| **Setup detail** | `/setups/[symbol]` | Chart with toggleable layers, score breakdown, WHY ENTER / WHY WAIT, FACT / INTERPRETATION / ASSUMPTION blocks, three trade plans, invalidation, risk calculator, news for that market, "Teach me this setup". |
| **News** | `/news` | Economic calendar with the source's own 1–3 star impact rating, actual / forecast / previous, beat-or-missed, a blackout window around high-impact releases, and **"what did this market actually do the last N times this printed?"** measured against real candles. |
| **Positions** | `/positions` | A manual tracker — no broker connection, no orders. Record what you opened in your platform, track it against live price, grade the outcome in R. Structure-aware SL and break-even reasoning, management log. |
| **Journal** | `/journal` | Trade classification, MFE/MAE, plan adherence, per-symbol R, missed setups (anti-hindsight), personal rules engine. |
| **Coach** | `/coach` | Chat with the coach in Coach or Direct mode at three explanation levels, psychology patterns from journal evidence, weekly report, 27-term glossary. |
| **Training** | `/training` | Candle-by-candle market replay. Play / pause / next / fast-forward / reset, make your call, get scored. Every practice trade is kept with the entry price, the SL and TP you placed, where price actually went, and the result in R — not just "right" or "wrong". No future candles leak. |
| **Guide** | `/guide` | The in-app usage guide: what each screen is for, what the Setup Quality Score does and does not mean, whether the chart is delayed, and what the app cannot do. TH + EN. |
| **Settings** | `/settings` | Account & risk, watchlist, timeframes, data sources with per-symbol provider + quality, AI, alerts, display, storage, honest limitations. |

### The thing that matters most: who computes what

```
┌─────────────────────────────┐        ┌───────────────────────────────┐
│  packages/engine  (code)    │        │  packages/ai  (language model)│
│                             │        │                               │
│  swings, HH/HL/LH/LL        │  ───▶  │  explains                     │
│  BOS / CHoCH / MSS          │        │  coaches                      │
│  trend + phase, regime      │        │  teaches                      │
│  S/D zones + freshness      │        │  answers questions            │
│  pullback vs reversal       │        │                               │
│  MTF alignment 4H→1H→15M→5M │        │  NEVER invents a number       │
│  Setup Quality Score 0-100  │        │  NEVER recomputes a level     │
│  SL / TP / R:R / sizing     │        │                               │
│  scanner state, no-trade    │        │  Output is zod-validated;     │
│                             │        │  engine numbers overwrite     │
│  100% deterministic         │        │  anything the model says      │
└─────────────────────────────┘        └───────────────────────────────┘
```

Every price, level, score and ratio you see in the app came out of TypeScript, not out of a
language model. If the model and the engine disagree about a number, the engine wins —
mechanically, in `packages/ai/src/provider.ts`.

**Setup Quality Score is not a win probability.** It scores how textbook-clean the setup is
(zone freshness, reaction strength, structural impact, HTF alignment, confirmation, R:R).
**AI Confidence** is a separate number describing how sure the model is about its *reading*.
They are never merged, and Top Opportunities is ordered by quality/readiness/R:R — never by
AI confidence.

---

## 2. Project structure

```
ai-trading-coach/
├── package.json                  pnpm workspace root; dev / build / typecheck / test / verify
├── pnpm-workspace.yaml
├── tsconfig.base.json            strict: true, noUncheckedIndexedAccess: true
├── tsconfig.check.json           whole-monorepo typecheck entry
├── .env.example                  every variable, with a description of what breaks without it
├── supabase/
│   └── migrations/
│       └── 0001_init.sql         22 enums, 28 tables, RLS on every table, signup trigger
├── docs/
│   └── DEPLOY.md                  Vercel deployment, step by step, with the known limits
├── packages/
│   ├── types/                    the single source of truth for every shared type
│   │   └── src/index.ts          Timeframe, Asset, Candle, Swing, Structure, Zone, Setup,
│   │                             Trade, PsychologyTag, TIMEFRAMES, MTF_CHAIN, ...
│   ├── market-data/              provider interface + three implementations
│   │   ├── types.ts              MarketDataProvider, CandleRequest (incl. startTime/endTime
│   │   │                         so the news study can price a 30-minute window that
│   │   │                         happened eight months ago), DataStatus
│   │   ├── assets.ts             the 6 assets, DEFAULT_WATCHLIST, REFERENCE_PRICES
│   │   ├── mock.ts               seeded (mulberry32) synthetic candles  → quality DEMO
│   │   ├── binance.ts            keyless public REST, crypto             → quality LIVE
│   │   ├── twelvedata.ts         keyed REST, metals + FX                 → quality LIVE
│   │   └── service.ts            picks a provider per symbol, falls back honestly
│   ├── engine/                   ALL the maths. No network, no LLM, no React.
│   │   ├── indicators.ts         ATR, EMA, swing detection, displacement
│   │   ├── structure.ts          HH/HL/LH/LL, BOS, CHoCH, MSS, trend + phase
│   │   ├── zones.ts              S/D zone discovery, freshness, reaction, impact
│   │   ├── context.ts            market regime, pullback-vs-reversal, MTF alignment
│   │   ├── scoring.ts            Setup Quality Score + component breakdown + grade
│   │   ├── risk.ts               sizing, R:R, structure SL, break-even, MFE/MAE,
│   │   │                         summarizePerformance (expectancy, PF, max DD)
│   │   ├── setups.ts             analyze(): the one entry point the app calls
│   │   ├── scanner.ts            multi-asset ranking + the five buckets
│   │   ├── psychology.ts         trade classification, behaviour patterns, weekly report
│   │   └── replay.ts             ReplayController — truncates every timeframe by the clock
│   ├── news/                     economic calendar behind a NewsProvider interface
│   │   ├── types.ts              NewsProvider, NewsEvent, NewsImpact, NewsRisk, ReactionStudy
│   │   ├── relevance.ts          which currencies move which symbol (gold and crypto are
│   │   │                         priced in USD, so US releases count)
│   │   ├── tradingview.ts        primary: numeric actual/forecast/previous + years of
│   │   │                         release history, keyless                    → LIVE
│   │   ├── forexfactory.ts       second line: schedule + impact, no actuals, this week
│   │   ├── investing.ts          opt-in scraper; Cloudflare blocks Node's TLS fingerprint
│   │   ├── mock.ts               seeded demo calendar, badged as synthetic
│   │   ├── reaction.ts           studyReactions(): medians, not means; "mixed" when the
│   │   │                         past is split; "unknown" below 3 samples; unmeasurable
│   │   │                         releases are skipped-and-counted, never approximated
│   │   └── service.ts            provider priority + cache; always names who answered
│   └── ai/
│       ├── schema.ts             the 18-key structured-output contract (zod)
│       ├── labels.ts             FACT / INTERPRETATION / ASSUMPTION tagging
│       ├── prompt.ts             system + task prompts, TH/EN, 3 levels, coach/direct
│       ├── claude.ts             Anthropic implementation of AiProvider
│       ├── local.ts              LocalExplainer: deterministic prose, zero API key
│       └── provider.ts           createAiProvider() + guardLanguage() banned-phrase guard
└── apps/web/                     Next.js 16 + React 19 + Tailwind v4
    └── src/
        ├── app/
        │   ├── layout.tsx        dark terminal shell, i18n provider, bottom nav
        │   ├── page.tsx + HomeView.tsx
        │   ├── markets/ setups/ setups/[symbol]/ news/ positions/ journal/ coach/
        │   │   training/ guide/ settings/
        │   └── api/              candles, analysis, scan, status, news, news/reaction,
        │                         ai/analyze, ai/chat
        ├── components/           PriceChart (lightweight-charts), SetupCard, ScoreBreakdown,
        │                         FactBlock, PlansPanel, AiPanel, RiskCalculator, JournalForm,
        │                         NewsPanel + NewsRiskStrip, ui.tsx
        ├── i18n/
        │   ├── provider.tsx      React-context i18n, instant switch, persisted, default Thai
        │   └── locales/{th,en}/{common,trading,coach,journal,settings,news,guide}.json
        └── lib/
            ├── env.ts            server-only env reader + capability booleans
            ├── scan.ts           fetch candles → run engine (server side)
            ├── news.ts           calendar window + relevance filter + the reaction study,
            │                     budgeted for a free data tier (10 releases, 4 in flight)
            ├── settings.ts       UserSettings + DEFAULT_SETTINGS + mergeSettings
            ├── store.ts          localStorage persistence: settings, journal, rules
            ├── glossary.ts       27 terms, English term + localised explanation
            ├── format.ts         locale-aware number/price/R formatting
            ├── home.ts           Home-screen derivation
            └── setup.ts          setup-detail derivation
```

---

## 3. Setup

Requires **Node ≥ 20** (developed on 24.15.0) and **pnpm 11**.

```bash
# 1. install
cd ai-trading-coach
pnpm install

# 2. (optional) configure
cp .env.example .env.local
#    Everything is optional. With an empty file the app still runs:
#    crypto is LIVE from Binance, metals/FX are clearly labelled DEMO,
#    explanations come from the deterministic engine, data lives in localStorage.

# 3. run
pnpm dev                     # http://localhost:3000
pnpm dev -- --port 3300      # if 3000 is taken by another project

# 4. verify
pnpm verify                  # typecheck + all test suites
```

**Deploying?** `docs/DEPLOY.md` walks through Vercel step by step — repository setup, the one
monorepo setting that is not auto-detected (Root Directory = `apps/web`), which environment
variables matter, the function-timeout and rate-limit numbers, and what to check on the
first deploy.

Other scripts:

```bash
pnpm typecheck     # tsc -p tsconfig.check.json --noEmit  (whole monorepo, strict)
pnpm test          # engine, scoring, ai-schema and mock-provider suites
pnpm build         # production build (Turbopack)
pnpm start         # serve the production build
pnpm lint          # eslint, flat config (Next 16 removed `next lint`)
```

`pnpm lint` exits 0 with warnings. Three React-Compiler rules (`react-hooks/refs`,
`set-state-in-effect`, `purity`) are downgraded to warnings in
`apps/web/eslint.config.mjs`, with the reason for each written next to it — the replay
trainer holds its `ReplayController` in a ref on purpose, and `localStorage` hydration has to
happen in an effect because it does not exist during SSR. The compiler itself is off, so the
rules are advice about a refactor rather than about a bug. They are warnings rather than
silenced so the debt stays visible.

On a phone: `pnpm dev` prints a LAN URL (e.g. `http://192.168.1.40:3000`) — open that on the
handset while on the same Wi-Fi. The UI was designed at phone width first.

### Database (optional)

```bash
# with the Supabase CLI, against a linked project
supabase db push

# or: open the SQL editor of a new Supabase project and paste
#     supabase/migrations/0001_init.sql
```

Then put `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Until you do, the app uses localStorage and
says so on the Settings screen rather than pretending to be persistent.

---

## 4. Environment variables

| Variable | Required | Default | Effect when absent |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | no | — | Prose comes from the deterministic `LocalExplainer`. **All numbers identical**, wording stiffer. UI labels the source. |
| `ANTHROPIC_MODEL` | no | app default | — |
| `TWELVE_DATA_API_KEY` | no | — | XAUUSD / EURUSD / GBPUSD / USDJPY fall back to the mock provider and are labelled **DEMO** everywhere. |
| `ENABLE_BINANCE` | no | `true` | `false` sends BTCUSDT / ETHUSDT to DEMO too. No key needed when true. |
| `FORCE_DEMO_DATA` | no | `false` | `true` forces every symbol to DEMO — demos, offline work, saving quota. |
| `CANDLE_LIMIT` | no | `400` | Candles requested per timeframe. Structure detection wants ≥ 200. |
| `ENABLE_NEWS` | no | `true` | `false` sends the whole news feature to the seeded demo calendar. Needs no key when true. |
| `ENABLE_INVESTING_CALENDAR` | no | `false` | Opt-in third source. Leave off on Vercel — see §9.3. |
| `NEWS_TTL_SECONDS` | no | `900` | Calendar cache. The reaction study caches far longer, because past candles do not change. |
| `NEXT_PUBLIC_SUPABASE_URL` | no | — | Storage falls back to localStorage. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | — | Same. RLS is what protects data, so this key is public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | — | Server-only. Bypasses RLS. Never prefix with `NEXT_PUBLIC_`. |

Keys are read **only** in `apps/web/src/lib/env.ts`, which is server-only and is never
imported from a `"use client"` module. The browser learns about configuration exclusively
through `GET /api/status`, which returns capability booleans and provider *names* — never a
key, never a key fragment.

---

## 5. API endpoints

All routes are `dynamic = "force-dynamic"`. Errors return `{ "error": string }` with 400
(bad input), 404 (unknown symbol / no setup) or 502 (upstream failure).

### `GET /api/candles`

Raw OHLCV plus the data-quality status — the status travels *with* the candles so the UI can
never render a chart without saying where the prices came from.

| Param | Type | Default |
|---|---|---|
| `symbol` | required, e.g. `XAUUSD` | — |
| `timeframe` | one of `1m 5m 15m 30m 1h 4h 1d` | `15m` |
| `limit` | 1–1000 | `CANDLE_LIMIT` |

```json
{
  "candles": [{ "time": 1759000000, "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0 }],
  "status": {
    "quality": "LIVE",
    "provider": "binance",
    "lastCandleTime": 1759000900,
    "candleCount": 400
  }
}
```

`status.note` appears only when there is something to admit — a degraded feed, a fallback, a
short history.

### `GET /api/analysis`

The complete deterministic read for one market. **No language model is involved in this
endpoint at all.**

| Param | Type | Default |
|---|---|---|
| `symbol` | required | — |
| `timeframe` | entry timeframe | `15m` |
| `candles` | `1` to include the raw candles | off |

Returns `{ symbol, entryTimeframe, price, atr, structures, zones, regime, pullback, mtf,
setups, best, dataStatus, noTradeReasons }`.

### `GET /api/scan`

Multi-asset scanner. Ordering is **readiness → Setup Quality → R:R → HTF agreement**. AI
confidence never affects the order.

| Param | Type | Default |
|---|---|---|
| `symbols` | comma-separated | `DEFAULT_WATCHLIST` |
| `timeframe` | entry timeframe | `15m` |

Returns `{ scannedAt, timeframe, opportunities, buckets, scans, failed }`, where `buckets`
holds the five scanner states and `failed` lists symbols whose data fetch failed — the
scanner reports gaps instead of quietly shrinking the universe.

### `GET /api/news`

The calendar for one market: only releases from currencies that actually move it.

| Param | Type | Default |
|---|---|---|
| `symbol` | required | — |
| `minImpact` | `1` \| `2` \| `3` | `2` |
| `ahead` | hours forward, ≤ 336 | `120` |
| `past` | hours back, ≤ 168 | `12` |

Returns `{ symbol, events, risk, currencies, provider, demo, note, fetchedAt }`. `provider`
names the source that actually answered (`tradingview`, `forexfactory`, `investing`, `mock`).

`risk.level` is `clear` \| `caution` \| `blackout`, and it is computed on the **unfiltered**
event list, so a row cap or a holiday filter can never turn a blackout into an all-clear.
A missing calendar returns `noData` — *"I have not checked"*, which is a different answer
from *"there is no risk"*.

### `GET /api/news/reaction`

*"Last time this printed hot, what did gold do?"* — answered arithmetically.

| Param | Type | Default |
|---|---|---|
| `symbol` | required | — |
| `eventId` | required | — |
| `path` | `COUNTRY|Indicator`, lets a cold server resolve the series | optional |

For every past release the provider knows about, the route fetches a small candle slice
around that moment (`CandleRequest.startTime/endTime`), measures the move over the 30
minutes after the print, and groups the results by whether the number beat or missed its
forecast. Returns `{ available, reason?, event, study, better, worse, releasesKnown,
dataStatus }`.

The honesty rules are in the response, not in the copy: `study.usable === false` means the
UI must say "not enough history"; `study.skipped` counts releases that could not be priced
rather than snapping them to a neighbouring bar; a group with fewer than 3 samples is
`unknown`; and a group below 70% directional consistency is `mixed` — *"this release does
move this market, but it does not tell you which way"*.

### `GET /api/status`

What the browser is allowed to know about the server.

```json
{
  "capabilities": { "llm": false, "database": false, "liveCrypto": true, "liveForex": false, "forcedDemo": false, "news": true },
  "candleLimit": 400,
  "aiModel": null,
  "providers": [{ "symbol": "XAUUSD", "display": "Gold", "assetClass": "metal", "provider": "mock", "quality": "DEMO" }]
}
```

### `POST /api/ai/analyze`

Runs the engine first, then asks the AI layer to explain the chosen setup.

```json
{ "symbol": "XAUUSD", "timeframe": "15m", "setupId": "...", "locale": "th", "level": "intermediate", "mode": "coach" }
```

Returns `{ analysis, source, note, provider, setupId, dataStatus, languageGuard }`.
`source` is `"llm"` or `"deterministic"` and is always surfaced in the UI. `languageGuard`
is the result of the banned-phrase check.

### `POST /api/ai/chat`

The Coach screen. Re-analyses the market server-side so the answer is grounded in the
current engine read rather than in chat history.

```json
{ "intent": "chat", "symbol": "XAUUSD", "timeframe": "15m", "setupId": null,
  "locale": "th", "level": "intermediate", "mode": "coach",
  "messages": [{ "role": "user", "content": "..." }],
  "trades": [] }
```

`trades` carries the local journal with the question, which is how the coach is allowed to
make behavioural observations: **no psychological claim without journal evidence.** Returns
`{ content, source, provider, intent, setupId }`.

---

## 6. How the Claude integration works

```
apps/web/src/app/api/ai/* (server only)
        │
        │ 1. run the deterministic engine → Setup with real numbers
        ▼
packages/ai/src/provider.ts  createAiProvider(env)
        │
        ├── ANTHROPIC_API_KEY present → ClaudeProvider  (claude.ts)
        └── absent                    → LocalExplainer  (local.ts)
        │
        │ 2. prompt.ts builds the system + task prompt:
        │      locale (th|en) · level (beginner|intermediate|advanced) · mode (coach|direct)
        │      plus the engine's facts, serialised
        │
        │ 3. the model must reply with the 18-key JSON contract
        │
        │ 4. schema.ts validates it with zod. Invalid → fall back to LocalExplainer.
        │
        │ 5. engine numbers OVERWRITE the model's numbers. Always.
        │
        │ 6. guardLanguage() rejects "guaranteed", "95% accurate", "safe trade", etc.
        ▼
{ analysis, source: "llm" | "deterministic", note }
```

The contract itself (`packages/ai/src/schema.ts`), which is the whole reason the output is
renderable rather than a wall of prose:

```ts
{
  asset, timeframe, market_regime, direction,        // what it is looking at
  setup_status,
  setup_quality,            // 0-100. Never a win probability.
  ai_confidence,            // 0-100. A different question entirely.
  entry_zone: { low, high },                         // a range, not a magic price
  confirmation_required: string[],
  stop_loss, take_profit: number[], risk_reward,
  why_enter: string[], why_wait: string[],           // both, always
  invalidation: string[],                            // where the idea dies
  facts: string[], interpretation: string[], assumptions: string[]   // §35
}
```

Design points worth knowing:

- **Swappable by interface, not by `if`.** `AiProvider` is a plain interface
  (`name`, `available`, `analyze`, `chat`). Adding GPT/Gemini/a local model means writing one
  file next to `claude.ts`; nothing else in the codebase changes.
- **The fallback is a first-class citizen, not an error path.** `LocalExplainer` produces
  real, structured, correct explanations from the engine output. The app is fully usable with
  no API key — it is just drier. That is also what makes the whole thing cheap to run.
- **FACT / INTERPRETATION / ASSUMPTION** is enforced in the schema, so the UI can render the
  three with different weight. The user can always see which part of a paragraph is a
  measurement and which part is an opinion.
- **The model may say it was wrong.** The schema has room for it and the prompt permits it.
  Prior analyses are never rewritten; invalidated setups stay visible and greyed out.

---

## 7. Market-data provider architecture

```ts
interface MarketDataProvider {
  readonly name: string;
  readonly quality: DataQuality;                 // "LIVE" | "DEMO" | "DELAYED"
  supports(symbol: string): boolean;
  fetchCandles(req: CandleRequest): Promise<CandleResponse>;
  /** Optional live stream. Providers without one return null and the UI polls. */
  subscribe?(
    req: Omit<CandleRequest, "limit">,
    onCandle: (candle: Candle) => void,
  ): (() => void) | null;
}
```

`MarketDataService` holds providers in priority order (live feeds first, demo last),
resolves one per symbol (`providerFor`), and exposes `getCandles` plus `getMtf` — which loads
the whole 4H→1H→15M→5M chain and **reports the weakest quality in the chain**, so one DEMO leg
is never hidden behind three LIVE ones. The app never calls an HTTP trading API directly:

| Symbols | Provider | Key? | Quality |
|---|---|---|---|
| BTCUSDT, ETHUSDT | `binance` — public REST `/api/v3/klines` | no | **LIVE** |
| XAUUSD, EURUSD, GBPUSD, USDJPY | `twelvedata` | yes | **DELAYED** on the free tier, with the note *"re-check levels against your broker feed before executing"* attached to every response. Constructible as `LIVE` for a paid tier. |
| anything, when no keyed provider matches | `mock` — seeded mulberry32 | no | **DEMO** |

The mock provider is deterministic (seeded per symbol+timeframe), so demo charts are stable
between reloads, produce genuine structure and zones, and the engine can be tested without a
network. `FORCE_DEMO_DATA=true` routes everything here.

**The quality label is never cosmetic.** `DataStatus` is attached to every candle response,
flows through `analyze()` into every `Setup`, and is rendered next to every chart and in
every AI answer. A DEMO chart is labelled DEMO in the chart header, in the setup card, in the
scanner row and in the AI's own preamble. Nothing in this codebase presents synthetic data
as a real price.

Adding stocks / ETFs / indices later = add an `Asset` entry plus (if needed) one provider
file. The engine never asks what asset class it is looking at.

---

## 8. Tests

```bash
pnpm test        # all suites
pnpm verify      # typecheck + all suites   ← the gate
```

**100 assertions across 5 suites, all passing.** No network, no API keys, fully deterministic.

| Suite | Count | Covers |
|---|---|---|
| `packages/engine/src/engine.test.ts` | 28 | ATR never zero even on a flat series · candle body metrics · swings alternate and are labelled · an uptrend really produces HH/HL · BOS detection · zones carry scores, freshness and bounded geometry · fresh zones outscore invalidated ones · zone distance is 0 inside the zone · `analyze` never returns an empty explanation · **demo data is reported as DEMO, never LIVE** · **insufficient history is refused rather than guessed** · plans expose best price, safer price and a structural stop · **re-entry into the same zone is refused** · sizing in lots for FX and units for crypto · the calculator warns instead of silently accepting a bad stop · **break-even requires 1R plus a new protected swing** · MFE/MAE measured from post-entry candles · expectancy / profit factor / drawdown · **replay never reveals candles beyond the cursor** · **a practice call is settled against the candles that actually followed it** — whichever of the stop and the target price reached first, with the exit price, exit time, bars held, MFE/MAE and the result in R all returned, never a bare "correct" · **a candle that contains both the stop and the target resolves to the stop and is flagged `ambiguous`**, because candles carry no tick sequence and the flattering read would be a guess |
| `packages/engine/src/scoring.test.ts` | 15 | **component weights sum to exactly 1** · aligned trend-pullback grades above a conflicted one · counter-trend is penalised on the HTF component · no zone ⇒ zero zone component · grade boundaries are stable · **quality and confidence are independent scores** · live data with the full MTF chain raises confidence · trend agreement is 0 for opposing legs · a loss with no linked setup is an *emotional trade*, not a *valid loss* · a widened stop is flagged `moved_stop` · a winner that ran to 1.5R and closed flat is flagged early-BE · **revenge trading needs evidence of the sequence, not a guess** · **an empty journal produces no behaviour claims** · alerts only fire on meaningful change |
| `packages/ai/src/schema.test.ts` | 17 | the structured contract matches spec · out-of-range scores rejected · JSON wrapped in prose or code fences still parses · **malformed output is rejected, not patched** · guaranteed-outcome language blocked in *both* languages · **engine numbers always overwrite model numbers** · the deterministic explainer is schema-valid in both languages · **Thai output is actually Thai** (regex-checked per field) and English never leaks Thai · Thai labels keep the technical term in English · the prompt hands over facts and forbids inventing numbers · **the chat prompt forbids psychology claims when the journal is empty** · teach-me walks the trader's own 10-step process · **no API key falls back to the deterministic explainer, not a fake LLM** · chat refuses to discuss a chart when none is loaded |
| `packages/news/src/news.test.ts` | 28 | a pair's own two currencies outrank everything else · gold and crypto are tied to USD even though their base is not a currency · irrelevant currencies and holidays filtered out · **a high-impact release minutes away is a blackout, not a suggestion** · the blackout still holds just after the print · hours away is caution, not blackout · **a missing calendar reports `noData` instead of a false all-clear** · the study measures the candle containing the release against the one before · **releases outside the candle coverage are skipped, never approximated** · an in-line print is excluded because it is not a surprise · a consistent reaction is reported with its direction and sample count · **a split reaction is called `mixed` rather than forced into a direction** · **too few samples is `unknown`, not a weak tendency** · the median ignores a single extreme release · TradingView rows keep the source's own impact rating and UTC time · **an inverted series is judged for the currency, not by the raw number** (jobless claims falling is `better`) · history keeps only the asked-for series and the comparable prints · **the ForexFactory feed gives impact strength but never invents an `actual`** · **the service names whichever source actually answered** · the demo calendar labels every row synthetic · a failed scrape falls back to demo and explains why · the service caches instead of hammering the source · **every provider failing returns emptiness, not invented rows** · **a market that simply does not react is `unknown`, not `mixed`** · an unknown event id has no synthetic history |
| `packages/market-data/src/mock.test.ts` | 12 | the catalogue covers all six required markets · crypto has no pip-value-per-lot, FX does · candles ordered, timeframe-aligned and internally consistent · **the generator is deterministic for the same symbol+timeframe** · prices stay in a plausible band per instrument · a custom seed reproduces a replay exactly · **provider support is declared honestly** · priority puts live feeds first and demo last · routing per symbol · **the mock provider always labels its data DEMO** · **a failing live feed degrades to DEMO and says why** · the MTF loader reports the weakest quality in the chain |

The bolded cases are the honesty invariants. They are the tests that would catch the product
quietly lying — presenting demo data as live, patching malformed model output into something
plausible, letting a model's number survive into the UI, claiming the trader is revenge
trading without evidence, or leaking a future candle into a replay.

Typechecking is part of the gate because the project runs TypeScript `strict` **plus**
`noUncheckedIndexedAccess`, which is doing real work here: candle-array indexing is where
off-by-one bugs in a structure engine actually live.

---

## 9. Known limitations

Stated plainly, because the whole point of the product is not overstating what it knows.

1. **Metals and FX are DEMO without `TWELVE_DATA_API_KEY`, and DELAYED with a free one.**
   Crypto is genuinely LIVE from Binance with no key at all. Delayed and demo data are
   labelled as such on every chart, every setup card, every scanner row and in the AI's own
   preamble — never silently. Zones and structure barely move on a few seconds of delay, so
   planning on DELAYED data is fine; executing on it is not, which is what your broker's
   chart is for.
2. **Polling, not WebSocket.** Prices can lag your broker slightly. There is no tick data,
   so intra-candle sequencing (did the high or the low come first?) is unknown — the engine
   does not pretend otherwise, and the replay trainer flags the ambiguous candles rather
   than resolving them in your favour.
3. **The calendar does not come from investing.com**, even though that is the site most
   traders read. investing.com sits behind Cloudflare and rejects Node's TLS fingerprint —
   the ClientHello, not the headers. Measured: plain `fetch` → 403; `fetch` with a full set
   of browser headers → 403; `node:https` with Chrome's exact cipher list, `ecdhCurve` and
   `sigalgs` → 403 plus a challenge body; the same URL with `curl` → 200. Not fixable from
   inside Node, therefore not fixable on Vercel, so the provider is opt-in
   (`ENABLE_INVESTING_CALENDAR`, default off). What actually serves the calendar is
   **TradingView's economic-calendar service** — keyless, Node-reachable, and strictly
   richer: numeric actual/forecast/previous, the same 1–3 impact rating, and years of
   release history. ForexFactory is the second line (schedule only, no actuals, current
   week only). `NewsService` always names the source that answered and the UI prints it.
4. **The calendar only knows scheduled releases.** A surprise headline, a central banker
   going off script or a geopolitical shock will not be in any calendar, and the app does
   not pretend to see them. An empty calendar means *no data*, never *no risk* — a feed
   failure returns `noData`, which the UI renders as "not checked", not as "clear".
5. **The reaction study is a measurement, not a forecast.** At most 10 past releases are
   priced per event (the free Twelve Data tier is 8 req/min), medians are used rather than
   means, groups under 3 samples report `unknown`, groups under 70% directional consistency
   report `mixed`, and releases whose candles cannot be fetched are skipped and counted
   rather than snapped to a neighbouring bar.
6. **Positions is a manual tracker.** There is no broker connection anywhere in the app, by
   design, and no code path that can place, modify or close an order. You open the trade in
   your own platform and record it here.
7. **Without `ANTHROPIC_API_KEY` the prose is deterministic.** Identical numbers, stiffer
   language, no free-form conversation depth.
8. **Without Supabase, everything lives in this browser.** Clearing site data deletes the
   journal. Export from Settings before you do.
9. **AI accuracy tracking is scaffolded, not populated.** Per-grade calibration ("setups the
   AI graded A resolved like this") needs persisted history, so the Coach screen says
   "not enough samples" instead of showing a flattering number.
10. **Replay is training, not backtesting.** It replays real provider history candle by candle
    with no lookahead, settles every practice call against the candles that followed, and
    keeps the entry/exit prices and R — but it does not yet persist results across sessions
    or sweep parameters over a date range. The `backtests` / `backtest_trades` tables are
    there for when it does.
11. **Journal statistics are honest about thin samples.** Below 20 trades the app shows the
    numbers but flags them as not yet meaningful, and undefined ratios render as `—` rather
    than `0`.
12. **No auth UI yet.** The SQL has RLS, `auth.uid()` policies and a signup trigger ready, but
    the app currently runs single-user and local.
13. **Six symbols, one timeframe chain.** The architecture is asset-class agnostic; the
    watchlist and the mandatory 4H→1H→15M→5M chain are not.

---

## 10. Prioritised next steps

**P0 — make the data durable**
1. Wire the Supabase client behind the existing `lib/store.ts` interface so journal, rules,
   settings and positions persist across devices. The schema is already written; this is
   adapter work, not design work.
2. Email auth + the signup trigger that is already in the migration.
3. Persist `setups` and `setup_events` as they are produced. This single change unlocks
   alerts-on-change (§20), real AI accuracy tracking and genuine backtests, because all three
   need history that currently evaporates on reload.

**P1 — close the honesty gaps**
4. WebSocket streaming for Binance, then for the FX provider, with the LIVE badge upgraded to
   show staleness in seconds.
5. Populate `ai_accuracy` and show real per-grade calibration on the Coach screen, including
   the cases where the AI was wrong.
6. Persist the reaction studies so the release history is not re-measured per cold start, and
   widen the sample cap past 10 once the data tier allows it.

**P2 — deepen the coaching**
7. Push notifications for the alert engine (the `notifications` table already stores the
   `trigger` jsonb that proves which state change justified sending).
8. Screenshot upload on journal entries (`trade_screenshots` is ready) so the replay/review
   loop can compare the chart you saw against the chart that happened.
9. Turn replay into a real backtester: date-range sweeps, persisted `backtest_trades`, and the
   AI review pass over the results.
10. Expand to indices and equities, which mostly means session-aware handling of gaps and
    exchange hours in the context engine.

---

## 11. Notable implementation decisions

Documented because they are deviations or non-obvious trade-offs.

- **The engine is TypeScript, not Python.** The brief suggested a Python/FastAPI analysis
  service. TypeScript won for three reasons: one deploy instead of two; one set of types
  shared end-to-end (`@atc/types` is imported by the engine, the API and the React
  components, so a structure change cannot drift); and — decisively — **the engine runs in
  the browser**, which is what makes the replay trainer genuinely interactive and genuinely
  leak-free. `ReplayController.visible()` truncates every timeframe by the replay clock and
  hands the slice straight to `analyze()` with no round-trip.
- **Thai is the default locale**, and Thai copy is written the way a trader speaks, not the
  way a textbook translates. Technical terms stay in English (BOS, CHoCH, Supply Zone) with a
  Thai explanation attached, because that is how Thai traders actually say them.
- **localStorage first, database second.** The app had to be fully functional before any
  credentials exist, so persistence lives behind a hook interface (`useSettings`,
  `useJournal`, `useRules`) with a localStorage implementation today and a Supabase one
  dropped in later without touching a single component.
- **`psychology_logs.evidence` is `NOT NULL` in SQL.** The rule "never make a psychological
  claim without journal evidence" is enforced by the schema, not by prompt discipline.
- **Invalidated setups are updated, never deleted.** `setups.invalidated_at` plus
  `setup_events` keeps the whole lifecycle, so the app can show "ENTRY INVALIDATED — here is
  why" and the trader can learn from it instead of wondering what happened to the card.
