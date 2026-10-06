# Deploying to Vercel

The app is a pnpm workspace monorepo. The deployable unit is `apps/web`;
everything in `packages/*` is TypeScript source that Next compiles in place
(see `transpilePackages` in `apps/web/next.config.ts`).

It deploys with **zero environment variables set**. You will get a working app
that labels every market `DEMO` and writes its explanations with the
deterministic local explainer. Add keys to upgrade it — nothing breaks either
way, and the UI always says which mode it is in.

---

## 1. Put the code in a Git repository

The repo is not initialised yet. From the project root:

```bash
git init
git add .
git commit -m "AI Trading Coach"
git branch -M main
```

Check `git status` before committing and confirm that **no `.env.local` is
listed**. `.gitignore` already excludes `.env`, `.env.local`, `.env*.local`,
`node_modules/`, `.next/`, `.tmp/` and `.vercel/`.

Then create an empty repository on GitHub (no README, no .gitignore) and push:

```bash
git remote add origin https://github.com/<you>/ai-trading-coach.git
git push -u origin main
```

---

## 2. Import the project on Vercel

1. <https://vercel.com/new> → pick the repository.
2. **Framework Preset**: Next.js (auto-detected).
3. **Root Directory**: `apps/web` — this is the one setting that is not
   auto-detected correctly for a monorepo. Vercel sees the `pnpm-workspace.yaml`
   at the repository root and installs from there, so the `workspace:*`
   dependencies resolve.
4. Leave Build Command and Output Directory empty (`next build`, `.next`).
5. Add environment variables (section 3) — or none at all for a first look.
6. **Deploy**.

### If install fails on the pnpm version

`package.json` pins `"packageManager": "pnpm@11.1.2"`. Vercel honours that
field via corepack. If a build ever fails during install with a pnpm version
error, either set `ENABLE_EXPERIMENTAL_COREPACK=1` in the project's environment
variables, or relax the pin to the major (`pnpm@11`) and redeploy.

### Node version

`engines.node` is `>=20`. Vercel's default (22.x) satisfies it. Nothing to do.

---

## 3. Environment variables

Add these under **Project → Settings → Environment Variables**, scope
*Production, Preview, Development*. Full annotated list in `.env.example`.

| Variable | Needed for | If missing |
|---|---|---|
| `TWELVE_DATA_API_KEY` | XAUUSD, EURUSD, GBPUSD, USDJPY | those four fall back to the seeded mock and are badged `DEMO` |
| `ENABLE_BINANCE` | BTCUSDT, ETHUSDT | defaults to `true`; crypto is `LIVE` with no key at all |
| `ANTHROPIC_API_KEY` | AI-written explanations and coaching | the deterministic `LocalExplainer` writes them; every **number** is identical |
| `ANTHROPIC_MODEL` | pinning a specific model | app default |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | settings / journal / positions / rules persisted per user | everything is stored in the browser's `localStorage` on that one device |
| `SUPABASE_SERVICE_ROLE_KEY` | creating accounts (`/api/auth/signup`), server-side writes that bypass RLS | sign-up only works if "Confirm email" is disabled on the project — see §4 |
| `ENABLE_NEWS` | News screen, home risk strips, setup news block | defaults to `true`, needs no key |
| `ENABLE_INVESTING_CALENDAR` | optional third calendar source | defaults to `false` — **leave it off on Vercel**, see below |
| `NEWS_TTL_SECONDS` | calendar cache | defaults to `900` |
| `FORCE_DEMO_DATA` | forcing everything to mock | defaults to `false` |
| `CANDLE_LIMIT` | candles per timeframe request | defaults to `400` |

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` ever reach
the browser, and both are public by design — Row Level Security is what
protects the data. Every other variable is read exclusively by
`apps/web/src/lib/env.ts`, which is server-only and is never imported from a
`"use client"` module.

### Known limitation: investing.com

The economic calendar does **not** come from investing.com, even though that is
the site most traders read.

investing.com sits behind Cloudflare and rejects Node's TLS fingerprint — the
ClientHello, not the headers. Measured, in order:

- plain `fetch` → `403`
- `fetch` with a full set of browser headers → `403`
- `node:https` with Chrome's exact cipher list, `ecdhCurve`, and `sigalgs` →
  `403` plus a Cloudflare challenge body
- the same URL with `curl` → `200`

That is not fixable from inside Node, so it is not fixable on Vercel. The
provider is kept behind `ENABLE_INVESTING_CALENDAR` (default off) for anyone
running the app somewhere that can reach the site.

What actually serves the calendar is **TradingView's economic-calendar
service**, which is reachable from Node and is strictly richer: numeric
`actual` / `forecast` / `previous`, an impact rating that maps onto the same
1–3 stars, and years of release history — which is what the "what did this
market do the last ten times?" study measures against real candles.
**ForexFactory** is the second line (schedule only, no actuals, current week
only), and the seeded demo calendar is the last resort. `NewsService` always
reports which source answered, and the UI prints it.

---

## 4. Database (optional)

Without Supabase the app is fully usable but single-device: settings, rules,
journal entries and positions live in `localStorage`, and the Settings screen
says so.

To enable persistence:

1. Create a project at <https://supabase.com>.
2. Run the files in `supabase/migrations/` **in numeric order** — either
   `supabase db push`, or paste each one into the project's SQL editor.
   `0001_init.sql` is the schema; `0002_auth_profile.sql` adds the trigger that
   gives every new account its profile, settings and default watchlist.
3. Copy the project URL, the anon key and the service-role key into the Vercel
   environment variables above.
4. Redeploy (environment changes do not apply to an existing build).

Every table in the migration has RLS enabled with `auth.uid()` policies.

### Accounts are username-only

Sign-up asks for a username and a password, nothing else — no email, no
verification step. Supabase Auth has no username credential, so each account
gets a synthetic address, `<username>@traderzaza.invalid`, derived from the
username by a pure function in `apps/web/src/lib/supabase.ts`.

Two consequences worth knowing before you deploy:

- **`SUPABASE_SERVICE_ROLE_KEY` is effectively required.** A `.invalid` address
  can never receive mail, so if the project has **Confirm email** switched on,
  an ordinary browser sign-up creates an account that can never be confirmed —
  and it burns the project's email quota (two per hour on the built-in SMTP)
  sending a message nobody will read. `/api/auth/signup` uses the service-role
  key to create the account already confirmed and sends nothing. The only
  alternative is to turn **Confirm email** off under Authentication → Sign In /
  Providers → Email, in which case browser sign-up works unaided.
- **The domain is the credential.** Changing `USERNAME_EMAIL_DOMAIN` after
  accounts exist orphans every one of them: the rows stay in `auth.users`, but
  no login form can ever produce their address again.

Signing in is optional — no screen is account-gated, and the analysis is
identical either way.

---

## 5. Function limits

Several server routes fan out to multiple timeframes across multiple markets,
and a free data tier is not fast. Those segments declare
`export const maxDuration = 60`:

- `/` , `/markets`, `/setups`, `/setups/[symbol]`
- `/api/scan`, `/api/analysis`
- `/api/ai/analyze`, `/api/ai/chat`
- `/api/news/reaction`

On Hobby, 60s is the ceiling and requires Fluid Compute (on by default for new
projects). If a deploy rejects `maxDuration = 60`, lower it to `10` — the app
still works, it will just occasionally show a per-symbol "feed failed" row
instead of a full scan.

### Rate limits worth knowing

Twelve Data's free tier is **8 requests/minute**. One full watchlist scan is
four timeframes × four non-crypto symbols = 16 requests, so a cold scan can
hit the limit and degrade individual symbols to `DEMO` with a reason attached.
That is honest behaviour, not a bug, but it is the first thing to fix with a
paid key if the app is used daily. The news reaction study already budgets for
this: at most 10 releases priced, 4 slices in flight, 6-hour cache.

---

## 6. After the first deploy

Open the deployment and check, in this order:

1. **`/settings`** → the "Market data" and "AI assistant" cards tell you
   exactly which providers answered. This is the fastest way to confirm your
   keys landed.
2. **`/`** → ranked setups render, and the data badge is what you expect
   (`LIVE` for crypto, `DELAYED`/`LIVE` for gold and FX with a Twelve Data key,
   `DEMO` without one).
3. **`/news`** → rows appear with stars and numbers, and the source line at the
   bottom of the panel says `tradingview`. Expand a release that already has an
   actual and confirm "see past reactions" returns measurements rather than
   "not enough history".
4. **`/guide`** → the in-app usage guide. Worth reading once.

If `/news` shows the demo badge, either `ENABLE_NEWS` is off or TradingView and
ForexFactory both failed; the panel prints which.

---

## 7. Local development

```bash
pnpm install
cp .env.example .env.local   # optional; fill in what you have
pnpm dev                      # http://localhost:3000
```

Before pushing anything:

```bash
pnpm verify   # tsc --noEmit across the workspace, then the test suites
pnpm build    # the same build Vercel runs
```

`pnpm verify` is the gate. It runs the engine, scoring, AI-schema, market-data
and news test suites — all deterministic, no network, no keys required.
