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

Eleven screens on the bottom navigation, plus a setup-detail route and the two auth pages:

| Screen | Path | What it does |
|---|---|---|
| **Home** | `/` | Proactive: opens straight onto "here are the best opportunities right now", market health, and what to do next. No question required. Above the list, and only when they have something to say: the **daily guard** (stop the day at your R limit, your trade count, or your open-position cap), **what your trading is actually earning** in money per trade and per day, and **which market is awake** — the scan grades structure, which is all it can measure, but the same grade means two different things at 14:00 and at 03:00 UTC. |
| **Signal** | `/signal` | Only the markets actually calling a trade, grouped by readiness rather than flattened into one score-sorted list — "enter now" and "leave a resting order at a price we have not reached" are different actions. |
| **Markets** | `/markets` | Per-asset trend/phase/regime, data quality, MTF agreement. |
| **Setups** | `/setups` | The multi-asset scanner: Top Opportunities plus the five buckets (ENTRY_NOW, WAIT_CONFIRMATION, LIMIT_ZONE, WATCHLIST, NO_TRADE). Every card carries its stop width against what the account can actually take, so a setup too wide to size is marked before it is opened rather than after. |
| **Setup detail** | `/setups/[symbol]` | Chart with toggleable layers, score breakdown, WHY ENTER / WHY WAIT, FACT / INTERPRETATION / ASSUMPTION blocks, three trade plans, invalidation, risk calculator (which now opens with **the widest stop this balance can carry** at the broker's minimum lot), news for that market, "Teach me this setup". |
| **News** | `/news` | Economic calendar with the source's own 1–3 star impact rating, actual / forecast / previous, beat-or-missed, a blackout window around high-impact releases, and **"what did this market actually do the last N times this printed?"** measured against real candles. |
| **Positions** | `/positions` | A manual tracker — no broker connection, no orders. Record what you opened in your platform, track it against live price, grade the outcome in R. Structure-aware SL and break-even reasoning, management log. |
| **Journal** | `/journal` | Trade classification, MFE/MAE, plan adherence, per-symbol R, missed setups (anti-hindsight), personal rules engine. |
| **Coach** | `/coach` | Chat with the coach in Coach or Direct mode at three explanation levels, psychology patterns from journal evidence, weekly report, 27-term glossary. |
| **Training** | `/training` | Candle-by-candle market replay. Play / pause / next / fast-forward / reset, make your call, get scored. Every practice trade is kept with the entry price, the SL and TP you placed, where price actually went, and the result in R — not just "right" or "wrong". No future candles leak. |
| **Guide** | `/guide` | The in-app usage guide: what each screen is for, what the Setup Quality Score does and does not mean, whether the chart is delayed, and what the app cannot do. TH + EN. |
| **Settings** | `/settings` | The account panel, risk, watchlist, timeframes, data sources with per-symbol provider + quality, AI, alerts, display, storage, honest limitations. |
| **Sign in / Sign up** | `/login`, `/signup` | Username and password, no email. Not linked from the nav and not required by any screen — reachable from the account chip in the top bar. |
| **Refresh control** | top bar, scanning screens only | Re-runs the scan, and says what that will cost in metered credits **before** the press — the only moment the number is useful. The chip beside it opens a per-market picker, so a trader who only watches gold can take the other five out of the scan instead of refreshing all of them. The selection is a cookie, so all four scanning screens and `GET /api/scan` agree on it. |

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
├── .github/workflows/ci.yml      typecheck + tests + build + lint on every push and PR
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql         22 enums, 28 tables, RLS on every table
│       └── 0002_auth_profile.sql trigger that provisions users / user_settings /
│                                 watchlists on signup, so an account can never exist
│                                 without its profile rows; plus a backfill
├── docs/
│   └── DEPLOY.md                  Vercel deployment, step by step, with the known limits
├── packages/
│   ├── types/                    the single source of truth for every shared type
│   │   └── src/index.ts          Timeframe, Asset, Candle, Swing, Structure, Zone, Setup,
│   │                             Trade, PsychologyTag, TIMEFRAMES, MTF_CHAIN, ...
│   ├── market-data/              provider interface + four implementations
│   │   ├── types.ts              MarketDataProvider, CandleRequest (incl. startTime/endTime
│   │   │                         so the news study can price a 30-minute window that
│   │   │                         happened eight months ago), DataStatus
│   │   ├── assets.ts             the 6 assets, DEFAULT_WATCHLIST, REFERENCE_PRICES
│   │   ├── mock.ts               seeded (mulberry32) synthetic candles  → quality DEMO
│   │   ├── binance.ts            keyless public REST, crypto             → quality LIVE
│   │   ├── yahoo.ts              keyless public REST, FX                 → quality LIVE
│   │   ├── twelvedata.ts         keyed REST, metals                      → quality DELAYED
│   │   └── service.ts            picks a provider per symbol, falls back honestly;
│   │                             estimateCost() prices a planned scan in credits
│   │                             before it runs, cache-aware and unioned by symbol
│   ├── engine/                   ALL the maths. No network, no LLM, no React.
│   │   ├── indicators.ts         ATR, EMA, swing detection, displacement
│   │   ├── structure.ts          HH/HL/LH/LL, BOS, CHoCH, MSS, trend + phase
│   │   ├── zones.ts              S/D zone discovery, freshness, reaction, impact
│   │   ├── context.ts            market regime, pullback-vs-reversal, MTF alignment
│   │   ├── scoring.ts            Setup Quality Score + component breakdown + grade
│   │   ├── risk.ts               sizing, R:R, structure SL, break-even, MFE/MAE,
│   │   │                         summarizePerformance (expectancy, PF, max DD),
│   │   │                         maxAffordableStop (the widest SL a balance can
│   │   │                         carry at the minimum lot), expectancy() in money
│   │   │                         per trade and per day, dailyGuard (loss limit,
│   │   │                         trade count, open positions, tilt streak)
│   │   ├── sessions.ts           which market is awake, read from Intl per exchange
│   │   │                         zone rather than a fixed UTC table, so DST is
│   │   │                         handled instead of approximated
│   │   ├── levels.ts             HTF key levels the chart alone cannot show: previous
│   │   │                         day/week high-low, weekly open, round numbers
│   │   ├── dollar.ts             USD strength from a basket, so a gold or FX setup is
│   │   │                         read against the dollar leg driving it
│   │   ├── backtest.ts           replays analyze() over history and settles each signal
│   │   │                         against the candles that actually followed it
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
    ├── vercel.json               the deploy gate: `verify` must pass before `next build`
    └── src/
        ├── app/
        │   ├── layout.tsx        terminal shell, theme + i18n + auth providers, bottom nav
        │   ├── page.tsx + HomeView.tsx
        │   ├── signal/ markets/ setups/ setups/[symbol]/ news/ positions/ journal/
        │   │   coach/ training/ guide/ settings/ login/ signup/
        │   └── api/              candles, analysis, scan, status, news, news/reaction,
        │                         ai/analyze, ai/chat, auth/signup
        ├── components/           PriceChart (lightweight-charts), SetupCard, ScoreBreakdown,
        │                         FactBlock, PlansPanel, AiPanel, RiskCalculator, JournalForm,
        │                         NewsPanel + NewsRiskStrip, AuthForm, AccountChip,
        │                         AccountPanel, ThemeSwitch, ui.tsx
        ├── i18n/
        │   ├── provider.tsx      React-context i18n, instant switch, persisted, default Thai
        │   ├── locales/{th,en}/{common,trading,coach,journal,settings,news,guide,auth}.json
        │   └── dictionaries.test.ts  the two locale trees must stay key-for-key identical
        └── lib/
            ├── env.ts            server-only env reader + capability booleans
            ├── scan.ts           fetch candles → run engine (server side)
            ├── news.ts           calendar window + relevance filter + the reaction study,
            │                     budgeted for a free data tier (10 releases, 4 in flight)
            ├── settings.ts       UserSettings + DEFAULT_SETTINGS + mergeSettings
            ├── store.ts          localStorage persistence: settings, journal, rules
            ├── supabase.ts       browser client + the username ⇄ synthetic-address mapping
            ├── auth.tsx          useAuth(): session state, sign in / up / out
            ├── theme.tsx         light/dark/system, applied before first paint
            ├── glossary.ts       27 terms, English term + localised explanation
            ├── format.ts         locale-aware number/price/R formatting
            ├── home.ts           Home-screen derivation
            ├── signal.ts         Signal-screen derivation
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
#    crypto is LIVE from Binance and FX is LIVE from Yahoo — neither needs a key —
#    gold is clearly labelled DEMO, explanations come from the deterministic
#    engine, and data lives in localStorage.

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
pnpm test          # engine, scoring, ai-schema, market-data, news, theme, auth, i18n
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

The same commands run without you. `.github/workflows/ci.yml` runs `verify` → `build` →
`lint` on every push and pull request to `main`, with no secrets passed to it, so a build
that only succeeds because a key happened to be set fails there. That gives you a red cross
on GitHub but does not stop a deployment — Vercel builds whatever is pushed. The block is
`apps/web/vercel.json`, whose build command is `pnpm -w run verify && next build`: a failing
test fails the build, and a failed build is never promoted, so the previous deployment stays
live. `docs/DEPLOY.md` §7 explains both layers and how to override them temporarily.

On a phone: `pnpm dev` prints a LAN URL (e.g. `http://192.168.1.40:3000`) — open that on the
handset while on the same Wi-Fi. The UI was designed at phone width first.

### Database (optional)

```bash
# with the Supabase CLI, against a linked project
supabase db push

# or: open the SQL editor of a new Supabase project and paste, in order,
#     supabase/migrations/0001_init.sql
#     supabase/migrations/0002_auth_profile.sql
```

Then put `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

**What the database is used for today is accounts, and only accounts.** Sign-up, sign-in and
the profile rows the trigger provisions. Journal entries, settings, rules and positions are
still written to `localStorage` by `lib/store.ts` whether or not a database is connected — so
signing in on a second device does not bring your data with it. The Settings screen says this
in those words rather than showing "Supabase" because the keys happen to be set.

Accounts are **username and password, with no email**. `lib/supabase.ts` maps a username onto
a synthetic `<username>@traderzaza.invalid` address because Supabase requires an address;
the mapping is lossless and round-trip tested. The consequence is worth stating plainly:
**there is no password reset**, because there is no address to send one to.

---

## 4. Environment variables

| Variable | Required | Default | Effect when absent |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | no | — | Prose comes from the deterministic `LocalExplainer`. **All numbers identical**, wording stiffer. UI labels the source. |
| `ANTHROPIC_MODEL` | no | app default | — |
| `TWELVE_DATA_API_KEY` | no | — | **Metals only now that Yahoo covers FX.** Without it XAUUSD falls back to the mock provider and is labelled **DEMO** everywhere. |
| `ENABLE_BINANCE` | no | `true` | `false` sends BTCUSDT / ETHUSDT to DEMO too. No key needed when true. |
| `ENABLE_YAHOO` | no | `true` | `false` hands EURUSD / GBPUSD / USDJPY back to TwelveData, or to DEMO without a key. A switch rather than a key, because there is no key to remove if Yahoo ever starts refusing the host. |
| `FORCE_DEMO_DATA` | no | `false` | `true` forces every symbol to DEMO — demos, offline work, saving quota. |
| `CANDLE_LIMIT` | no | `400` | Candles requested per timeframe. Structure detection wants ≥ 200. |
| `ENABLE_NEWS` | no | `true` | `false` sends the whole news feature to the seeded demo calendar. Needs no key when true. |
| `ENABLE_INVESTING_CALENDAR` | no | `false` | Opt-in third source. Leave off on Vercel — see §9.3. |
| `NEWS_TTL_SECONDS` | no | `900` | Calendar cache. The reaction study caches far longer, because past candles do not change. |
| `NEXT_PUBLIC_SUPABASE_URL` | no | — | No accounts: the sign-in and sign-up screens say so instead of failing on submit. Trading data is in localStorage either way. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | — | Same. RLS is what protects data, so this key is public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | — | Server-only, used by `POST /api/auth/signup`. Bypasses RLS. Never prefix with `NEXT_PUBLIC_`. |

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
| `symbols` | comma-separated | the `atc.watchlist` cookie, falling back to `DEFAULT_WATCHLIST` |
| `timeframe` | entry timeframe | `15m` |

Returns `{ scannedAt, timeframe, opportunities, buckets, scans, failed }`, where `buckets`
holds the five scanner states and `failed` lists symbols whose data fetch failed — the
scanner reports gaps instead of quietly shrinking the universe.

The default is the cookie rather than the full catalogue so that this route and the four
scanning screens answer the same question. Otherwise the API would keep spending metered
credits on markets the user had removed.

### `GET /api/scan-cost`

What a scan would cost in metered credits, asked **before** the user presses refresh —
the only moment the answer is useful.

Returns `{ baseline, baselineFull, perSymbol, selected, quota }`. Every tradable symbol is
priced, not only the selected ones, so the picker can answer "what would adding this cost?"
without a second round trip.

Per-symbol costs are **marginal** over `baseline` (the dollar basket, which loads whatever
the watchlist says), which makes them exactly additive: the total for any selection is
`baseline + sum(credits of selected)`. The client sums toggles locally and cannot disagree
with the server.

Each row carries both `credits` (what it costs right now, given what the cache already
holds) and `fullCredits` (what it costs once the candles age out). Both are reported
because immediately after a scan every `credits` reads zero, and showing only that would
teach the user that refreshing is permanently free.

The numbers are an upper bound: a TTL can lapse between the quote and the press, and an
exhausted budget turns a would-be charge into a cache read. Both errors are in the safe
direction.

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
  "capabilities": { "llm": false, "database": true, "liveCrypto": true, "liveForex": true, "liveMetals": false, "forcedDemo": false, "news": true },
  "candleLimit": 400,
  "aiModel": null,
  "providers": [{ "symbol": "XAUUSD", "display": "Gold / USD", "assetClass": "metal", "provider": "mock", "quality": "DEMO" }]
}
```

`liveForex` and `liveMetals` are separate booleans because they stopped having the same
answer: FX is live and keyless through Yahoo, while gold still needs a metals feed. One
combined flag would have had to lie about one of them.

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

### `POST /api/auth/signup`

```json
{ "username": "nick", "password": "..." }
```

Returns `{ ok: true }`, or `{ ok: false, code, detail?, fallback? }`. Sign-in and sign-out go
straight from the browser to Supabase; only sign-up needs a server route, because accounts
have no real address. If the project has *Confirm email* switched on, an ordinary signup
creates an unusable account — Supabase withholds the session until a link is clicked and
that link is sent to a domain that cannot exist. This route uses the admin endpoint with
`email_confirm: true`, which marks the address confirmed without sending anything.

The service-role key never leaves the module, and the response carries a status code and
nothing else — no token, no user record. When the key is absent the route answers
`needsConfirmation` with `fallback: true`, which tells the client to try signing up directly
instead; that works on a project with confirmation disabled.

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
| EURUSD, GBPUSD, USDJPY | `yahoo` — public REST `v8/finance/chart` | no | **LIVE** |
| XAUUSD | `twelvedata` | yes | **DELAYED** on the free tier, with the note *"re-check levels against your broker feed before executing"* attached to every response. Constructible as `LIVE` for a paid tier. |
| anything, when no keyed provider matches | `mock` — seeded mulberry32 | no | **DEMO** |

Yahoo sits **ahead of** TwelveData in the priority list on purpose: it is realtime and needs
no key, where the TwelveData free tier is delayed. It declares `supports()` false for XAUUSD,
so gold still routes to a metals feed rather than being quietly dropped.

Three things about that feed are measured facts rather than assumptions, and the provider is
built around them:

- **There is no 4h interval**, so 4h bars are folded from 1h into UTC-aligned buckets.
- **The live quote arrives as an extra row stamped "now"**, not at its bar's open time. Every
  row is snapped to `floor(time / targetSeconds) * targetSeconds` and merged into the bucket
  it belongs to — one code path that handles the live row and the 4h aggregation together.
  Daily bars are exempt, because Yahoo stamps FX dailies at 23:00 UTC and snapping would
  redate every one of them.
- **FX volume is always 0.** Checked against the engine rather than assumed: the volume
  signal is guarded by `avgVolume > 0`, so it goes quiet instead of misfiring.

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

**223 assertions across 16 suites, all passing.** No network, no API keys, fully deterministic.

| Suite | Count | Covers |
|---|---|---|
| `packages/engine/src/engine.test.ts` | 42 | ATR never zero even on a flat series · candle body metrics · swings alternate and are labelled · an uptrend really produces HH/HL · BOS detection · zones carry scores, freshness and bounded geometry · fresh zones outscore invalidated ones · zone distance is 0 inside the zone · `analyze` never returns an empty explanation · **demo data is reported as DEMO, never LIVE** · **insufficient history is refused rather than guessed** · plans expose best price, safer price and a structural stop · **re-entry into the same zone is refused** · sizing in lots for FX and units for crypto · the calculator warns instead of silently accepting a bad stop · **a size below the broker's minimum lot is refused with a reason, never rounded into one** — the comparison happens before rounding, because at two decimals an exact 0.0076 became a tradable 0.01 (a third more risk than asked for) and an exact 0.002 became 0.00 with no warning at all, and the refusal is asserted to carry the number that decides what to do next (what the smallest tradable lot would actually cost, as a figure and as a share of the balance) rather than only "too wide for this account" · **every phrase interpolates the same variables in both locales** — the engine catalogue has no fallback, so a `{minLotRisk}` misspelt in Thai renders literal braces and the number the sentence exists for never appears · **break-even requires 1R plus a new protected swing** · MFE/MAE measured from post-entry candles · expectancy / profit factor / drawdown · **replay never reveals candles beyond the cursor** · **a practice call is settled against the candles that actually followed it** — whichever of the stop and the target price reached first, with the exit price, exit time, bars held, MFE/MAE and the result in R all returned, never a bare "correct" · **a candle that contains both the stop and the target resolves to the stop and is flagged `ambiguous`**, because candles carry no tick sequence and the flattering read would be a guess · **session windows follow the exchange's own clock, not a fixed UTC table** — asserted at the *same UTC half-hour six months apart*, so a hardcoded "London is 08:00–17:00 GMT" passes one season and fails the other · the London/New York overlap is found in both halves of the year · thin hours are named thin and the weekend closed · **expectancy is reported in money per trade and per day actually traded** — in the trader's own local day, so a close at 23:00 and one at 01:00 are two days rather than one · **the widest affordable stop is the inverse of the min-lot refusal**: the stop width `maxAffordableStop` returns is exactly the one at which `calculateRisk` stops refusing · **the daily guard stops the day at the loss limit and not before** · **yesterday's losses do not spend today's limit** — the guard takes `dayStart` as a parameter rather than deriving it, because "today" is a wall-clock fact about where the trader sits, and getting it wrong fires the breaker permanently once the account is down 2R lifetime · **trade count and open positions are enforced independently of R**, asserted on a *winning* day, because both settings were previously displayed and read by nothing, and a limit the app shows but does not apply is worse than no limit · **a day nothing has happened on says nothing**, since a warning shown unconditionally stops being read by the time it has something to say |
| `packages/engine/src/scoring.test.ts` | 15 | **component weights sum to exactly 1** · aligned trend-pullback grades above a conflicted one · counter-trend is penalised on the HTF component · no zone ⇒ zero zone component · grade boundaries are stable · **quality and confidence are independent scores** · live data with the full MTF chain raises confidence · trend agreement is 0 for opposing legs · a loss with no linked setup is an *emotional trade*, not a *valid loss* · a widened stop is flagged `moved_stop` · a winner that ran to 1.5R and closed flat is flagged early-BE · **revenge trading needs evidence of the sequence, not a guess** · **an empty journal produces no behaviour claims** · alerts only fire on meaningful change |
| `packages/engine/src/levels.test.ts` | 18 | **the trading week starts on Monday, not on the Unix epoch's Thursday** · a gap in the candles produces no period, not an empty one · a period carries the first open and the last close, not the extremes of either · **the day still being written is never read as the previous day**, and the week's open is published immediately while its high and low wait for the close — a level the market has not finished making is not a level · round-number spacing scales with the instrument rather than a hardcoded grid, brackets price on both sides, and **does not move while the current day is still printing** · confluence decays with distance and dies past one ATR · a level out of range is dropped from the evidence rather than listed at zero · **a hard reference outranks a soft one at the same distance, and a cluster of soft levels cannot out-argue one hard level** · the strongest level is cited first · **a level between entry and target is an obstacle, not confluence** · adding the component keeps the weights a set of shares summing to 1, so **confluence dilutes the other components instead of inflating the total**, and omitting it is not the same as scoring it zero |
| `packages/engine/src/dollar.test.ts` | 14 | **a pair with the dollar on the left moves opposite to one with it on the right** — the sign convention is the whole correctness of the reading · the index is weighted, not averaged, and **one pair is not an index** · a leg without the full window is dropped rather than measured over a shorter one · **a pair is never graded against an index it dominates**, which would be the setup arguing with itself · legs pulling against each other lower the agreement · **a move inside the window's own noise reads flat, not weakly directional** · one dollar move is a tailwind for one instrument and a headwind for another · an instrument with no dollar leg is omitted rather than scored neutral · **a ninth component takes its share from the others rather than adding to the total** · a setup with no dollar reading grades between one with a headwind and one with a tailwind |
| `packages/engine/src/backtest.test.ts` | 12 | **a higher-timeframe candle that has not finished printing is not visible**, and truncation applies each timeframe's own close rule rather than one rule for all — the lookahead that makes every backtest flattering · **the engine is handed no more history than it gets live** · rewriting the future does not change a trade that already settled · **every signal is either a trade or a counted skip**, so the sample cannot be quietly narrowed to the ones that worked · a trade is settled against the bars that came after it, never its own · **R is measured from the fill that happened, not the entry the plan wanted** · excursions are stored the way the journal stores them · the same zone is not traded twice · **the grade verdict refuses to answer on a sample too thin to answer with**, and fails when a worse grade out-earns a better one · the report names every grade even when a grade never traded |
| `packages/ai/src/schema.test.ts` | 20 | the structured contract matches spec · out-of-range scores rejected · JSON wrapped in prose or code fences still parses · **malformed output is rejected, not patched** · guaranteed-outcome language blocked in *both* languages · **engine numbers always overwrite model numbers** · the deterministic explainer is schema-valid in both languages · **Thai output is actually Thai** (regex-checked per field) and English never leaks Thai · Thai labels keep the technical term in English · the prompt hands over facts and forbids inventing numbers · **the chat prompt forbids psychology claims when the journal is empty** · teach-me walks the trader's own 10-step process · **no API key falls back to the deterministic explainer, not a fake LLM** · chat refuses to discuss a chart when none is loaded |
| `packages/news/src/news.test.ts` | 28 | a pair's own two currencies outrank everything else · gold and crypto are tied to USD even though their base is not a currency · irrelevant currencies and holidays filtered out · **a high-impact release minutes away is a blackout, not a suggestion** · the blackout still holds just after the print · hours away is caution, not blackout · **a missing calendar reports `noData` instead of a false all-clear** · the study measures the candle containing the release against the one before · **releases outside the candle coverage are skipped, never approximated** · an in-line print is excluded because it is not a surprise · a consistent reaction is reported with its direction and sample count · **a split reaction is called `mixed` rather than forced into a direction** · **too few samples is `unknown`, not a weak tendency** · the median ignores a single extreme release · TradingView rows keep the source's own impact rating and UTC time · **an inverted series is judged for the currency, not by the raw number** (jobless claims falling is `better`) · history keeps only the asked-for series and the comparable prints · **the ForexFactory feed gives impact strength but never invents an `actual`** · **the service names whichever source actually answered** · the demo calendar labels every row synthetic · a failed scrape falls back to demo and explains why · the service caches instead of hammering the source · **every provider failing returns emptiness, not invented rows** · **a market that simply does not react is `unknown`, not `mixed`** · an unknown event id has no synthetic history |
| `packages/market-data/src/mock.test.ts` | 16 | the catalogue covers all six required markets · crypto has no pip-value-per-lot, FX does · candles ordered, timeframe-aligned and internally consistent · **the generator is deterministic for the same symbol+timeframe** · prices stay in a plausible band per instrument · a custom seed reproduces a replay exactly · **provider support is declared honestly** · priority puts live feeds first and demo last · routing per symbol, including **FX must not need a key** · **the Yahoo live quote is folded into the bar it belongs to** · **a live quote with no completed bar yet still lands on its bucket** (the regression that produced 302-second spacing on USDJPY) · 1h bars aggregate into UTC-aligned 4h bars · **Yahoo daily bars keep the exchange's own date** rather than being redated by the snap · **the mock provider always labels its data DEMO** · **a failing live feed degrades to DEMO and says why** · the MTF loader reports the weakest quality in the chain |
| `packages/market-data/src/quota.test.ts` | 14 | **one watchlist scan costs half the per-minute allowance** — the arithmetic (4 timeframes × 1 credit against 8/min) is pinned as an assertion so growing `MTF_CHAIN` fails the build instead of silently breaking the feed · the budget refuses the credit that would exceed the minute and recovers on a *rolling* window, not a fixed boundary · the daily cap stops spending even when the minute is clear, and a new UTC day restores it · **an exhausted budget fails without spending a request** (`fetch` is stubbed to assert zero calls — a 429 learned from the far end has already cost the round trip) · a second read inside the TTL never reaches the provider, and does again once it expires · **a failing feed serves the last real candles, not demo ones**, downgraded to DELAYED and carrying the reason and the age · with nothing cached a failure still draws a chart, labelled DEMO · **a demo fallback is never written to the cache**, so recovery is immediate rather than pinned for a whole TTL · **a DEMO success never becomes the stale-real fallback** — otherwise synthetic prices get served under a note promising "the last real candles" · the cache lifetime scales with the bar within a floor and ceiling · a windowed request is a different series and must not collide with the live one · **the quoted price drops to zero once the cache can answer it**, and climbs back as each TTL lapses one bar at a time — a flat per-symbol price would be wrong most of the time, and the whole point of quoting before the press is that the number is the one the press will actually cost · **a keyless feed is quoted at nothing however many bars it loads**, so the estimate tracks what is metered rather than what is fetched · **a series two parts of the plan both want is priced once** — the dollar basket overlaps the watchlist by three symbols, and pricing those legs separately would invent credits that are never spent, in the one number the user checks before deciding whether they can afford to press |
| `packages/market-data/src/twelvedata.test.ts` | 4 | **every request pins `timezone=UTC`, not just the historical slices** · a returned row is read as the instant it names · **no candle is ever dated into the future**. TwelveData's datetimes are naive in both directions, and unset, `timezone` governs the `start_date` it reads *and* the `datetime` it writes while `exchange_timezone` comes back null — so nothing announces which clock is in use. The parameter was sent only on sliced requests, so historical windows were right and every chart and watchlist scan was wrong: XAU/USD's exchange sits at UTC+11 under southern-hemisphere DST, so gold arrived stamped eleven hours in the future, with prices correct to the cent. A newest bar dated tomorrow, a "last update" counting backwards, and a staleness check measuring now against a future time. The stand-in feed here answers with the exchange-local label when the timezone is unpinned, because one that replied identically either way could not fail |
| `apps/web/src/app/theme.test.ts` | 6 | both themes define exactly the same tokens · **every text token is readable on every surface it is drawn on**, measured as contrast against globals.css itself rather than against a copy of the palette · non-text tokens keep their meaning · chart marks stand out from the chart background, which matches the page it is embedded in |
| `apps/web/src/lib/supabase.test.ts` | 6 | **the username ⇄ synthetic-address round trip is lossless** for every name the rules allow · the same name always produces the same address however it was typed · the login field accepts either form · normalising is idempotent · **usernames are rejected for a named reason**, not just rejected |
| `apps/web/src/lib/signal.test.ts` | 4 | **`measured` counts the markets that answered, not the markets that were asked** · a scan where every market failed measured nothing, and reports no blocked markets either — a market that never loaded was not *blocked*, it was *absent* · **an empty scan is never badged as live data** · every scanning screen still carries the branch that tells the two kinds of nothing apart |
| `apps/web/src/lib/watchlist.test.ts` | 12 | The cookie is the one piece of user-controlled input that directly drives metered spending, so it is validated rather than parsed. **A symbol the catalogue does not know never reaches the scanner** — `requireAsset` throws, so a stale cookie from an older build would take down every scanning screen at once rather than degrade · **repetition cannot multiply what the scan costs**, and the catalogue is the ceiling on how much a cookie can ask for · **a malformed percent-escape does not take the server render down** (`decodeURIComponent("%")` throws, and unhandled that is a 500 on four screens triggered from devtools) · **an unusable cookie falls back to the full default, never to an empty list** — an empty scan draws the same screen as a scan that found nothing, and this app's whole posture is that those two must never look alike · what the browser writes is what the server reads back, over the same bytes · **a burst of clicks removes every market that was clicked**: React batches clicks in one tick, so a toggle computed from the render closure would drop all but the last, and the user unticks four markets, sees three still ticked, and keeps paying for them · **removing the last market is refused rather than silently reversed**, because an empty cookie reads as "no preference" and would widen the scan to all six — the opposite of the press, and billed for it · a market ticked back on returns to its place in the catalogue instead of being appended, so toggling does not reorder the dashboard underneath the user |
| `apps/web/src/lib/scan-cost.test.ts` | 6 | **Unticking the only metered market does not remove the way to tick it back on.** The chip showing the price is also the only entry point to the market picker, so a visibility rule keyed to the *selection* deletes the control the moment it is used as intended: drop gold, the total falls to zero, the chip vanishes, and gold can never be restored from the header again. Visibility is asserted to be a property of the catalogue, never of the selection — found by doing it in the browser, not by reading the code · a deployment with no metered feed shows no price at all, since a permanent "0" is noise · **the quoted total is the sum of the rows the server priced**, which is exact rather than approximate because per-symbol costs are marginal over a baseline that already contains the only shared series · **a warm cache is quoted free without hiding what it costs cold** · the baseline is charged even when the watchlist is empty · a symbol the catalogue has dropped is ignored rather than thrown over, because the selection lives in localStorage and can outlive a release |
| `apps/web/src/i18n/dictionaries.test.ts` | 6 | **every namespace defines exactly the same keys in both locales** · no translation is blank · **a key interpolates the same `{{variables}}` in both locales** · **every placeholder is written in the form `interpolate` actually substitutes** · **the dictionary names every session and liquidity level the engine can emit** · the guide renders every bullet its translations define. `translate()` falls back to the other locale before falling back to the key, which is right at runtime but means a missing Thai string renders as English and nobody notices — so parity is asserted rather than maintained by hand. The last two guards exist because parity only catches an *asymmetric* mistake: a string written `{points}` instead of `{{points}}` is never substituted and ships literal braces to the screen, and a dictionary missing a liquidity level renders a raw key — but do both in *both* locales and every other test here passes. One shipped that way across four features before the placeholder guard was added |

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

1. **Gold is the only market still on demo data.** Crypto is LIVE from Binance and FX is LIVE
   from Yahoo, both keyless. XAUUSD needs `TWELVE_DATA_API_KEY` and is labelled **DEMO**
   until it has one — on every chart, every setup card, every scanner row and in the AI's own
   preamble, never silently. With a free key it becomes DELAYED. Zones and structure barely
   move on a few seconds of delay, so planning on DELAYED data is fine; executing on it is
   not, which is what your broker's chart is for. That free key is also **metered** — 8
   credits a minute and 800 a day, against four per gold scan — so the cache and the credit
   budget described in §11 are what keep it inside the allowance. Left running continuously
   on every timeframe, gold alone would want roughly 70 credits an hour, which fits a trading
   session comfortably and a 24-hour unattended dashboard not at all.
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
8. **Trading data lives in this browser, with or without Supabase.** The database is wired up
   and used for accounts, but `lib/store.ts` still writes the journal, settings, rules and
   positions to `localStorage` — so signing in on a second device does not bring them across,
   and clearing site data deletes them. Settings has an export button; there is no import
   button yet, so the file is a copy rather than a restore path.
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
12. **Accounts exist, but they do not own anything yet.** Sign-up, sign-in and sign-out work,
    the trigger provisions the profile rows, and RLS and `auth.uid()` policies are in place —
    but no screen reads from or writes to those tables, so being signed in changes nothing
    except the name in the top bar. Signing in is therefore optional and nothing is gated
    behind it. Accounts are username-only by request, which means **no password reset**:
    there is no address to send one to.
13. **Six symbols, one timeframe chain.** The architecture is asset-class agnostic; the
    watchlist and the mandatory 4H→1H→15M→5M chain are not.

---

## 10. Prioritised next steps

**P0 — make the data durable**
1. Wire the Supabase client behind the existing `lib/store.ts` interface so journal, rules,
   settings and positions persist across devices. The schema is already written and so is the
   auth that would key it; this is adapter work, not design work. It is the one change that
   would make signing in mean something.
2. Import to match the existing export, so a backup file is a restore path and not just a
   copy.
3. Persist `setups` and `setup_events` as they are produced. This single change unlocks
   alerts-on-change (§20), real AI accuracy tracking and genuine backtests, because all three
   need history that currently evaporates on reload.

**P1 — close the honesty gaps**
4. ~~A real gold feed~~ — **done**: TwelveData covers XAUUSD at DELAYED on the free tier,
   cached and credit-budgeted per §11, and verified against the live API. PAXG/XAUT were
   measured and rejected first, because they trade through the weekend and would invent
   candles that do not exist in the gold market the trader's broker shows. What remains is
   the *realtime* half: the free tier is delayed, and the only free realtime metal prices
   found are Yahoo's COMEX futures (`GC=F`, `SI=F`), which sit roughly $18 above spot — 180
   pips on an entry level, so they are a different instrument rather than a cheaper feed and
   would have to be labelled as one, not substituted silently.
5. WebSocket streaming for Binance, then for the FX provider, with the LIVE badge upgraded to
   show staleness in seconds. Both feeds are polled today; `subscribe()` exists on the
   provider interface and returns `null` for every implementation.
6. Populate `ai_accuracy` and show real per-grade calibration on the Coach screen, including
   the cases where the AI was wrong.
7. Persist the reaction studies so the release history is not re-measured per cold start, and
   widen the sample cap past 10 once the data tier allows it.

**P2 — deepen the coaching**
8. Push notifications for the alert engine (the `notifications` table already stores the
   `trigger` jsonb that proves which state change justified sending).
9. Screenshot upload on journal entries (`trade_screenshots` is ready) so the replay/review
   loop can compare the chart you saw against the chart that happened.
10. Turn replay into a real backtester: date-range sweeps, persisted `backtest_trades`, and the
    AI review pass over the results.
11. Expand to indices and equities, which mostly means session-aware handling of gaps and
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
- **Gold is cached and budgeted rather than simply fetched, because the free tier cannot
  survive this app's own access pattern.** TwelveData's free plan allows 8 credits a minute
  and one `time_series` call costs one, while the mandatory 4H/1H/15M/5M chain means a single
  gold scan costs four. Four screens scan the watchlist and every one is `force-dynamic`, so
  two page loads inside a minute spent the whole allowance and the third got a 429 — measured,
  not predicted. Three things follow. The `MarketDataService` cache is **not an optimisation
  but the thing that makes the tier usable at all**, with a TTL derived from the bar (a minute
  is most of a 5M bar's life and nothing on a 4H) rather than one number for everything.
  `CreditBudget` checks the allowance *before* building the request, because a 429 discovered
  from the far end has already cost the round trip and, worse, arrives as a failure the cache
  must paper over. And the fallback ladder is ordered fresh → **stale-but-real** → demo: when
  the feed refuses, real candles from four minutes ago beat synthetic candles from this
  instant, because the levels on them were actually traded, which is the only reason to look
  at a chart. Demo responses are never cached, in either direction — not the fallback and not
  a successful DEMO fetch — or one failure would pin synthetic prices for a whole TTL and the
  stale-real branch would serve them under a note promising "the last real candles". Two
  limits are stated rather than hidden: the count is per server process, so another instance
  sharing the key is invisible to it, and the daily reset assumes UTC. Neither breaks
  correctness, because a real 429 still degrades gracefully; this is a budget that avoids the
  common case, not a distributed quota manager. The remaining credits are shown in Settings,
  since "gold went DEMO" is a symptom and "7 of 8 spent this minute" is the cause.
- **The price is quoted before the press, and the watchlist is the lever that changes it.**
  Showing the budget after the fact only names the damage, so `estimateCost` prices the
  planned scan next to the refresh button and the same control lets the user untick the
  markets they do not trade. On this deployment that matters less than it sounds and the
  honest version is worth stating: **gold is the only symbol that costs anything.** The FX
  pairs are served by keyless Yahoo and the crypto pairs by keyless Binance, so a full
  six-market scan costs the same four credits as a gold-only one, and the saving from
  unticking EUR/USD is exactly zero. The picker reports `free` against those rows rather
  than implying a saving that is not there. What it does buy is the inverse: unticking
  *gold* takes the scan to zero credits and makes the metered feed irrelevant until it is
  turned back on. Two design notes, both found by using it rather than by reading it.
  `metered` is a **required** field on `MarketDataProvider`, not an optional one, so a
  provider cannot be added without someone answering whether it costs money — the compiler
  caught two fixtures the moment it was introduced. And the chip's visibility is keyed to
  the catalogue rather than to the selection, because the chip is also the only way into
  the picker: hiding it when the selection costs nothing meant unticking gold deleted the
  control needed to tick gold back on.
- **Thai is the default locale**, and Thai copy is written the way a trader speaks, not the
  way a textbook translates. Technical terms stay in English (BOS, CHoCH, Supply Zone) with a
  Thai explanation attached, because that is how Thai traders actually say them.
- **localStorage first, database second.** The app had to be fully functional before any
  credentials exist, so persistence lives behind a hook interface (`useSettings`,
  `useJournal`, `useRules`) with a localStorage implementation today and a Supabase one
  dropped in later without touching a single component.
- **Accounts are a username and a password, with no email.** The brief assumed email auth;
  this is for the author and one or two friends, and an email round trip with no password
  reset at the end of it is ceremony rather than security. Supabase requires an address, so
  `lib/supabase.ts` maps the username onto `<username>@traderzaza.invalid` — a reserved TLD
  that cannot resolve, so a confirmation mail can never be sent anywhere real. The round trip
  is lossless and tested, the login field takes either form, and `/api/auth/signup` creates
  the account pre-confirmed so the synthetic address is never put in the critical path. The
  cost is stated rather than hidden: a forgotten password cannot be recovered, and both the
  sign-up screen and the in-app guide say so.
- **"No signal" and "no data" are two different components, not one with a flag.** Both end
  up as an empty list, and on a trading screen they mean opposite things: the first says
  *stay out, that is the answer*, the second says *you are looking at nothing, do not
  conclude anything*. `Empty` is the result and `FeedFailure` is the absence; the scanning
  screens pick between them on `measured`, the count of markets that actually answered. Three
  consequences follow. A failed feed is reported **above** the results rather than in a
  footnote under them, because it is context you need before you read a ranking. When nothing
  was measured, the "nothing qualifies" line is **withheld entirely** rather than restyled —
  an unlabelled market cannot be described as quiet. And the notice is amber with `⚠` rather
  than the red it started as, because in this UI red already means *short*, and a feed that
  timed out is a statement about the data, not about direction.
- **The privacy disclosure is driven by the capability flag, not written as a constant.**
  "Storage mode: this device only" is true of persistence and silent about transmission, and
  the gap between those two is the whole privacy question here: §68 requires journal evidence
  before the coach may say anything about the trader's habits, so `coach/page.tsx` sends the
  journal with every question, and with a key configured `chatSystemPrompt` puts the recent
  rows in the prompt to Anthropic. Nothing in the UI said so. The "Your data" card now states
  what leaves the device, and the AI line reads from `capabilities.llm` rather than being
  typed out, because the two cases are opposite claims — *your journal goes to Anthropic* and
  *no AI provider sees it* — and a hardcoded string would be a lie in one of them. It sits
  next to the storage-mode row it qualifies rather than in a policy page nobody opens.
- **`psychology_logs.evidence` is `NOT NULL` in SQL.** The rule "never make a psychological
  claim without journal evidence" is enforced by the schema, not by prompt discipline.
- **Invalidated setups are updated, never deleted.** `setups.invalidated_at` plus
  `setup_events` keeps the whole lifecycle, so the app can show "ENTRY INVALIDATED — here is
  why" and the trader can learn from it instead of wondering what happened to the card.
