-- =============================================================================
-- AI Trading Coach — initial schema (§49)
--
-- Design notes that matter when reading this file:
--
-- 1. Every table that holds user data has Row Level Security enabled and a
--    policy keyed on auth.uid(). There is no "allow all" policy anywhere (§77).
-- 2. Reference data (assets) and market data (candles, market_data) are shared
--    and world-readable but service-role-writable only: a user must never be
--    able to edit price history, otherwise the journal stops being evidence.
-- 3. Enums mirror packages/types/src/index.ts exactly. If you add a value in
--    one place you must add it in the other, which is why they are declared
--    here rather than left as free-text columns.
-- 4. Scores are stored as the engine produced them. `quality_score` is a setup
--    quality score, never a win probability (§6). The column comments say so
--    on purpose: they are read by anyone writing a query against this schema.
-- 5. Timestamps are timestamptz. Candle open times are also kept as bigint
--    unix seconds because that is what the chart library and the engine use.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums (mirror of packages/types)
-- -----------------------------------------------------------------------------

create type timeframe as enum ('1m', '5m', '15m', '30m', '1h', '4h', '1d');

create type asset_class as enum ('forex', 'metal', 'crypto', 'index', 'stock', 'etf');

create type data_quality as enum ('LIVE', 'DELAYED', 'DEMO');

create type trend_state as enum (
  'strong_bullish', 'bullish', 'weak_bullish', 'ranging',
  'transition', 'weak_bearish', 'bearish', 'strong_bearish'
);

create type trend_phase as enum (
  'continuation', 'weakening', 'reversal_risk',
  'consolidation', 'expansion', 'compression'
);

create type market_regime as enum (
  'trending_up', 'trending_down', 'ranging', 'expansion',
  'compression', 'high_volatility', 'low_volatility'
);

create type zone_kind as enum ('demand', 'supply');

create type zone_freshness as enum (
  'fresh', 'tested_once', 'tested_twice', 'tested_multiple', 'weak', 'invalid'
);

create type zone_structural_impact as enum (
  'caused_bos', 'caused_choch', 'caused_mss',
  'strong_rejection', 'continuation', 'none'
);

create type pullback_verdict as enum ('pullback', 'reversal', 'unclear');

create type setup_status as enum (
  'WATCHING', 'ZONE_APPROACHING', 'IN_ZONE', 'WAITING_CONFIRMATION',
  'ENTRY_VALID', 'ACTIVE', 'MANAGING', 'COMPLETED', 'INVALIDATED'
);

create type scanner_state as enum (
  'ENTRY_NOW', 'WAIT_CONFIRMATION', 'LIMIT_ZONE', 'WATCHLIST', 'NO_TRADE'
);

create type entry_type as enum ('aggressive', 'confirmation', 'retest', 'probe');

create type trade_direction as enum ('long', 'short');

create type setup_direction as enum ('long', 'short', 'none');

create type quality_grade as enum ('A', 'B', 'C', 'D');

create type trade_classification as enum (
  'valid_loss', 'bad_setup', 'good_setup_bad_execution',
  'emotional_trade', 'missed_trade', 'valid_win'
);

create type psychology_tag as enum (
  'fomo', 'revenge', 'overconfidence', 'early_entry', 'late_entry',
  'oversizing', 'moved_stop', 'early_breakeven', 'emotional_reentry',
  'over_analysis', 'refused_valid_setup'
);

create type app_locale as enum ('th', 'en');

create type explanation_level as enum ('beginner', 'intermediate', 'advanced');

create type coach_mode as enum ('coach', 'direct');

create type structure_event_type as enum ('BOS', 'CHOCH', 'MSS');

-- -----------------------------------------------------------------------------
-- Helper: keep updated_at honest without application code having to remember
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- Reference data
-- =============================================================================

create table assets (
  symbol text primary key,
  display text not null,
  asset_class asset_class not null,
  min_tick numeric not null check (min_tick > 0),
  pip_size numeric not null check (pip_size > 0),
  -- Null for crypto, where position size is in units rather than lots.
  pip_value_per_lot numeric,
  quote text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table assets is 'Tradable instrument catalogue. Adding stocks/ETFs/indices later means inserting rows here, not changing code (§3).';

-- =============================================================================
-- Users and their configuration
-- =============================================================================

create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  locale app_locale not null default 'th',
  experience_level explanation_level not null default 'intermediate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references users (id) on delete cascade,
  account_balance numeric not null default 1000 check (account_balance >= 0),
  currency text not null default 'USD',
  risk_percent numeric not null default 1 check (risk_percent > 0 and risk_percent <= 100),
  small_account_mode boolean not null default true,
  max_trades_per_day integer not null default 3 check (max_trades_per_day > 0),
  max_open_positions integer not null default 2 check (max_open_positions > 0),
  entry_timeframe timeframe not null default '15m',
  coach_mode coach_mode not null default 'coach',
  explanation_level explanation_level not null default 'intermediate',
  show_ai_confidence boolean not null default true,
  chart_layers jsonb not null default
    '{"swings":true,"structure":true,"zones":true,"entries":true}'::jsonb,
  refresh_seconds integer not null default 60 check (refresh_seconds >= 5),
  alerts jsonb not null default
    '{"newSetup":true,"entryValid":true,"approaching":true,"invalidated":true,"qualityJump":false,"minGrade":"C"}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on column user_settings.alerts is 'Alert preferences (§20). Alerts fire on meaningful state change only, never on every refresh.';

create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null default 'default',
  symbols text[] not null default '{}',
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- =============================================================================
-- Market data (shared, service-role writable)
-- =============================================================================

create table market_data (
  symbol text primary key references assets (symbol) on delete cascade,
  last_price numeric,
  last_update timestamptz,
  provider text,
  quality data_quality not null default 'DEMO',
  note text
);

comment on table market_data is 'Latest snapshot per symbol. `quality` must be surfaced in the UI verbatim — never show DEMO data as if it were live (§54).';

create table candles (
  symbol text not null references assets (symbol) on delete cascade,
  timeframe timeframe not null,
  -- Candle open time, unix seconds: the engine and the chart library both use it.
  open_time bigint not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  quality data_quality not null default 'DEMO',
  provider text,
  primary key (symbol, timeframe, open_time)
);

create index candles_recent_idx on candles (symbol, timeframe, open_time desc);

-- =============================================================================
-- Deterministic engine output
-- =============================================================================

create table market_structures (
  id uuid primary key default gen_random_uuid(),
  symbol text not null references assets (symbol) on delete cascade,
  timeframe timeframe not null,
  computed_at timestamptz not null default now(),
  -- Unix seconds of the last candle the reading was computed from. Replay and
  -- backtesting rely on this so a reading is never attributed to future data.
  as_of bigint not null,
  trend trend_state not null,
  phase trend_phase not null,
  last_swing_high jsonb,
  last_swing_low jsonb,
  swings jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  facts text[] not null default '{}',
  unique (symbol, timeframe, as_of)
);

create table structure_events (
  id uuid primary key default gen_random_uuid(),
  symbol text not null references assets (symbol) on delete cascade,
  timeframe timeframe not null,
  event_type structure_event_type not null,
  direction text not null check (direction in ('bullish', 'bearish')),
  event_time bigint not null,
  price numeric not null,
  broken_swing_time bigint not null,
  displacement numeric not null,
  created_at timestamptz not null default now(),
  unique (symbol, timeframe, event_type, event_time)
);

comment on table structure_events is 'BOS / CHoCH / MSS history. Kept permanently so a past read can be reviewed, including the wrong ones (§43).';

create table supply_demand_zones (
  id uuid primary key default gen_random_uuid(),
  engine_id text not null,
  symbol text not null references assets (symbol) on delete cascade,
  timeframe timeframe not null,
  kind zone_kind not null,
  top numeric not null,
  bottom numeric not null check (bottom <= top),
  created_time bigint not null,
  freshness zone_freshness not null,
  tests integer not null default 0,
  reaction_strength numeric not null default 0,
  structural_impact zone_structural_impact not null default 'none',
  htf_aligned boolean not null default false,
  score numeric not null default 0 check (score >= 0 and score <= 100),
  displacement numeric not null default 0,
  time_in_zone integer not null default 0,
  distance_travelled numeric not null default 0,
  invalidated boolean not null default false,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, timeframe, engine_id)
);

comment on column supply_demand_zones.score is '0-100 zone quality (§6). NOT a win probability.';

-- =============================================================================
-- Setups, their lifecycle, and the entries they offer
-- =============================================================================

create table setups (
  id uuid primary key default gen_random_uuid(),
  engine_id text not null unique,
  symbol text not null references assets (symbol) on delete cascade,
  timeframe timeframe not null,
  direction setup_direction not null,
  status setup_status not null default 'WATCHING',
  scanner_state scanner_state not null default 'WATCHLIST',
  regime market_regime not null,
  quality_score numeric not null check (quality_score >= 0 and quality_score <= 100),
  quality_grade quality_grade not null,
  quality_components jsonb not null default '[]'::jsonb,
  ai_confidence numeric not null check (ai_confidence >= 0 and ai_confidence <= 100),
  zone_id uuid references supply_demand_zones (id) on delete set null,
  pullback_verdict pullback_verdict not null default 'unclear',
  pullback_strength numeric not null default 0,
  pullback_reasons text[] not null default '{}',
  mtf_agreement numeric not null default 0,
  mtf_legs jsonb not null default '[]'::jsonb,
  mtf_conflict text,
  confirmation_required text[] not null default '{}',
  why_enter text[] not null default '{}',
  why_wait text[] not null default '{}',
  invalidation text[] not null default '{}',
  facts text[] not null default '{}',
  interpretation text[] not null default '{}',
  assumptions text[] not null default '{}',
  data_quality data_quality not null default 'DEMO',
  data_provider text,
  data_candle_count integer not null default 0,
  -- An invalidated setup is marked, never deleted (§13).
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column setups.quality_score is '0-100 Setup Quality Score (§6, §16). Explicitly NOT a win probability — do not relabel it in any UI or report.';
comment on column setups.ai_confidence is 'How sure the analysis layer is about its own read (§17). A separate number from quality_score; never merge the two.';

create index setups_scan_idx on setups (symbol, scanner_state, quality_score desc);
create index setups_open_idx on setups (status) where invalidated_at is null;

create table setup_events (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references setups (id) on delete cascade,
  at timestamptz not null default now(),
  from_status setup_status,
  to_status setup_status not null,
  reason text not null
);

comment on table setup_events is 'Lifecycle transitions (§14). The full history is kept so the user can replay how a read evolved, including an invalidation.';

create index setup_events_setup_idx on setup_events (setup_id, at);

create table entry_points (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references setups (id) on delete cascade,
  engine_id text not null,
  name text not null check (name in ('Conservative', 'Balanced', 'Aggressive', 'No Trade')),
  entry_type entry_type not null,
  entry_zone_low numeric not null,
  entry_zone_high numeric not null,
  best_price numeric not null,
  safer_price numeric not null,
  stop_loss numeric not null,
  stop_loss_reason text not null,
  take_profits jsonb not null default '[]'::jsonb,
  risk_reward numeric not null default 0,
  -- < 1 means a probe entry: deliberately not the full position (§9).
  size_fraction numeric not null default 1 check (size_fraction > 0 and size_fraction <= 1),
  notes text[] not null default '{}',
  valid boolean not null default true,
  created_at timestamptz not null default now(),
  unique (setup_id, engine_id)
);

comment on column entry_points.size_fraction is 'Fraction of the normal risk unit. Below 1 the UI must label the entry a probe and say it is not the full position (§9).';

-- =============================================================================
-- Trades, management and the journal
-- =============================================================================

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  symbol text not null references assets (symbol),
  timeframe timeframe not null,
  direction trade_direction not null,
  entry_type entry_type not null,
  entry_price numeric not null,
  stop_loss numeric not null,
  take_profits numeric[] not null default '{}',
  size numeric not null check (size >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric,
  mfe_r numeric,
  mae_r numeric,
  result_r numeric,
  classification trade_classification,
  psychology psychology_tag[] not null default '{}',
  -- Null means the trade was not taken from a scanned setup, which the UI
  -- flags as an off-plan trade rather than silently accepting (§38).
  setup_id uuid references setups (id) on delete set null,
  followed_plan boolean,
  feeling text,
  notes text not null default '',
  -- §64: journal content is stored in the language it was written in.
  language app_locale not null default 'th',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trades_user_idx on trades (user_id, opened_at desc);
create index trades_open_idx on trades (user_id) where closed_at is null;

create table trade_management (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades (id) on delete cascade,
  at timestamptz not null default now(),
  action text not null check (
    action in ('move_stop', 'partial_close', 'add', 'break_even', 'close', 'note')
  ),
  price numeric,
  size_delta numeric,
  -- The engine's reason, stored verbatim. Break-even is never "+N points" (§26).
  reason text not null,
  suggested_by text not null default 'engine' check (suggested_by in ('engine', 'user', 'ai')),
  accepted boolean
);

create index trade_management_trade_idx on trade_management (trade_id, at);

create table trade_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  trade_id uuid references trades (id) on delete cascade,
  -- A journal entry can exist without a trade: missed setups are logged too (§42).
  symbol text references assets (symbol),
  kind text not null default 'trade' check (kind in ('trade', 'missed', 'false_read', 'note')),
  before_notes text,
  during_notes text,
  after_notes text,
  lesson text,
  language app_locale not null default 'th',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trade_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  trade_id uuid references trades (id) on delete cascade,
  journal_id uuid references trade_journal (id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz not null default now()
);

-- =============================================================================
-- Psychology and rules
-- =============================================================================

create table psychology_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  trade_id uuid references trades (id) on delete set null,
  tag psychology_tag not null,
  occurred_at timestamptz not null default now(),
  -- §68: a behaviour claim without evidence is not allowed to exist, so this
  -- column is NOT NULL. The evidence is quoted from the journal.
  evidence text not null,
  cost_r numeric not null default 0,
  created_at timestamptz not null default now()
);

comment on table psychology_logs is 'Behavioural observations (§42). `evidence` is NOT NULL on purpose: the coach may never assert a pattern it cannot point at.';

create index psychology_logs_user_idx on psychology_logs (user_id, occurred_at desc);

create table trading_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  text text not null,
  active boolean not null default true,
  -- Optional machine-checkable form, e.g. {"maxTradesPerDay": 2}.
  machine_rule jsonb,
  violations integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table trading_rules is 'The user writes these in their own words (§44). The engine warns before a violation; it never blocks the trade.';

create table rule_violations (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references trading_rules (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  trade_id uuid references trades (id) on delete set null,
  at timestamptz not null default now(),
  detail text not null
);

-- =============================================================================
-- Replay and backtesting
-- =============================================================================

create table replay_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  symbol text not null references assets (symbol),
  driver_timeframe timeframe not null default '15m',
  start_time bigint not null,
  cursor_time bigint not null,
  end_time bigint,
  calls_made integer not null default 0,
  calls_correct integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table replay_sessions is 'Market replay (§46). cursor_time is the replay clock; every timeframe must be truncated to it so future candles cannot leak into the analysis.';

create table replay_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references replay_sessions (id) on delete cascade,
  at_time bigint not null,
  call setup_direction not null,
  price numeric not null,
  resolved_at_time bigint,
  outcome text check (outcome in ('correct', 'wrong', 'draw')),
  reasoning text
);

create table backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  symbols text[] not null default '{}',
  entry_timeframe timeframe not null default '15m',
  from_time bigint not null,
  to_time bigint not null,
  min_quality numeric not null default 0,
  risk_percent numeric not null default 1,
  -- Aggregates computed by the engine, in R.
  trades integer not null default 0,
  win_rate numeric,
  expectancy_r numeric,
  profit_factor numeric,
  total_r numeric,
  max_drawdown_r numeric,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references backtests (id) on delete cascade,
  symbol text not null,
  timeframe timeframe not null,
  direction trade_direction not null,
  entry_type entry_type not null,
  quality_score numeric not null,
  quality_grade quality_grade not null,
  opened_at bigint not null,
  closed_at bigint,
  entry_price numeric not null,
  stop_loss numeric not null,
  exit_price numeric,
  result_r numeric,
  mfe_r numeric,
  mae_r numeric,
  exit_reason text
);

create index backtest_trades_bt_idx on backtest_trades (backtest_id, opened_at);

-- =============================================================================
-- AI output and news
-- =============================================================================

create table ai_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  setup_id uuid references setups (id) on delete cascade,
  symbol text not null references assets (symbol),
  timeframe timeframe not null,
  locale app_locale not null default 'th',
  level explanation_level not null default 'intermediate',
  -- The validated §50 JSON exactly as the provider returned it, after the
  -- engine reconciliation pass has overwritten every number.
  payload jsonb not null,
  -- 'llm' or 'deterministic'. The UI labels the source to the user (§70).
  source text not null check (source in ('llm', 'deterministic')),
  provider text not null,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  -- Banned-phrase guard result (§83). Non-empty means the text was rewritten.
  language_guard text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table ai_analysis is 'Stored so the user can review a past read, including one that turned out wrong. History is never rewritten (§43, §71).';

create index ai_analysis_setup_idx on ai_analysis (setup_id, created_at desc);

create table ai_accuracy (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references setups (id) on delete cascade,
  quality_grade quality_grade not null,
  ai_confidence numeric not null,
  -- Filled in once the outcome is known. Null means still unresolved; it must
  -- not be treated as a win (§72).
  outcome text check (outcome in ('played_out', 'invalidated', 'no_trade', 'unresolved')),
  result_r numeric,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table ai_accuracy is 'Per-grade calibration (§72). Lets the app show honestly how often an A-grade read actually worked out.';

create table news_events (
  id uuid primary key default gen_random_uuid(),
  symbol text references assets (symbol) on delete cascade,
  currency text,
  title text not null,
  importance text not null default 'low' check (importance in ('low', 'medium', 'high')),
  scheduled_at timestamptz not null,
  actual text,
  forecast text,
  previous text,
  source text not null,
  -- False when no feed is configured. The UI must then say it has no news
  -- data rather than implying the calendar is clear (§34).
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table news_events is 'Economic calendar (§34). An empty table means "no news data", which the UI must state explicitly — it never means "no news risk".';

create index news_events_time_idx on news_events (scheduled_at desc);

-- =============================================================================
-- Notifications (§20)
-- =============================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  setup_id uuid references setups (id) on delete cascade,
  kind text not null check (
    kind in ('new_setup', 'entry_valid', 'approaching', 'invalidated', 'quality_jump', 'rule_warning')
  ),
  title text not null,
  body text not null,
  -- The state change that justified sending this, so we can prove it was not spam.
  trigger jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

-- =============================================================================
-- updated_at triggers
-- =============================================================================

create trigger users_touch before update on users
  for each row execute function set_updated_at();
create trigger user_settings_touch before update on user_settings
  for each row execute function set_updated_at();
create trigger watchlists_touch before update on watchlists
  for each row execute function set_updated_at();
create trigger zones_touch before update on supply_demand_zones
  for each row execute function set_updated_at();
create trigger setups_touch before update on setups
  for each row execute function set_updated_at();
create trigger trades_touch before update on trades
  for each row execute function set_updated_at();
create trigger trade_journal_touch before update on trade_journal
  for each row execute function set_updated_at();
create trigger trading_rules_touch before update on trading_rules
  for each row execute function set_updated_at();
create trigger replay_sessions_touch before update on replay_sessions
  for each row execute function set_updated_at();

-- =============================================================================
-- Row Level Security
--
-- Shared tables: readable by any authenticated user, writable only by the
-- service role (which bypasses RLS). Declaring RLS with a read-only policy is
-- what makes "the client cannot write price history" true rather than hoped-for.
-- =============================================================================

alter table assets enable row level security;
alter table market_data enable row level security;
alter table candles enable row level security;
alter table market_structures enable row level security;
alter table structure_events enable row level security;
alter table supply_demand_zones enable row level security;
alter table setups enable row level security;
alter table setup_events enable row level security;
alter table entry_points enable row level security;
alter table ai_accuracy enable row level security;
alter table news_events enable row level security;

create policy assets_read on assets for select to authenticated using (true);
create policy market_data_read on market_data for select to authenticated using (true);
create policy candles_read on candles for select to authenticated using (true);
create policy market_structures_read on market_structures for select to authenticated using (true);
create policy structure_events_read on structure_events for select to authenticated using (true);
create policy zones_read on supply_demand_zones for select to authenticated using (true);
create policy setups_read on setups for select to authenticated using (true);
create policy setup_events_read on setup_events for select to authenticated using (true);
create policy entry_points_read on entry_points for select to authenticated using (true);
create policy ai_accuracy_read on ai_accuracy for select to authenticated using (true);
create policy news_events_read on news_events for select to authenticated using (true);

-- Per-user tables: the owner sees and edits their own rows and nothing else.

alter table users enable row level security;
create policy users_self on users for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table user_settings enable row level security;
create policy user_settings_self on user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table watchlists enable row level security;
create policy watchlists_self on watchlists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table trades enable row level security;
create policy trades_self on trades for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table trade_journal enable row level security;
create policy trade_journal_self on trade_journal for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table trade_screenshots enable row level security;
create policy trade_screenshots_self on trade_screenshots for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table psychology_logs enable row level security;
create policy psychology_logs_self on psychology_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table trading_rules enable row level security;
create policy trading_rules_self on trading_rules for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table rule_violations enable row level security;
create policy rule_violations_self on rule_violations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table replay_sessions enable row level security;
create policy replay_sessions_self on replay_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table backtests enable row level security;
create policy backtests_self on backtests for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notifications enable row level security;
create policy notifications_self on notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables are reached through their parent, so the policy follows the
-- parent's ownership rather than duplicating a user_id column.

alter table trade_management enable row level security;
create policy trade_management_self on trade_management for all to authenticated
  using (
    exists (select 1 from trades t where t.id = trade_management.trade_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from trades t where t.id = trade_management.trade_id and t.user_id = auth.uid())
  );

alter table replay_calls enable row level security;
create policy replay_calls_self on replay_calls for all to authenticated
  using (
    exists (
      select 1 from replay_sessions s
      where s.id = replay_calls.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from replay_sessions s
      where s.id = replay_calls.session_id and s.user_id = auth.uid()
    )
  );

alter table backtest_trades enable row level security;
create policy backtest_trades_self on backtest_trades for all to authenticated
  using (
    exists (select 1 from backtests b where b.id = backtest_trades.backtest_id and b.user_id = auth.uid())
  )
  with check (
    exists (select 1 from backtests b where b.id = backtest_trades.backtest_id and b.user_id = auth.uid())
  );

-- ai_analysis rows are either global (user_id null) or owned.
alter table ai_analysis enable row level security;
create policy ai_analysis_read on ai_analysis for select to authenticated
  using (user_id is null or user_id = auth.uid());
create policy ai_analysis_write on ai_analysis for insert to authenticated
  with check (user_id = auth.uid());

-- =============================================================================
-- Provision a users/user_settings row on signup so the app never has to guess
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.watchlists (user_id, name, symbols, is_default)
  values (new.id, 'default',
          array['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSDT', 'ETHUSDT'], true)
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================================================
-- Seed the asset catalogue (must match packages/market-data/src/assets.ts)
-- =============================================================================

insert into assets (symbol, display, asset_class, min_tick, pip_size, pip_value_per_lot, quote)
values
  ('XAUUSD',  'Gold / USD',     'metal',  0.01,   0.1,     10,   'USD'),
  ('EURUSD',  'Euro / USD',     'forex',  0.00001, 0.0001, 10,   'USD'),
  ('GBPUSD',  'Pound / USD',    'forex',  0.00001, 0.0001, 10,   'USD'),
  ('USDJPY',  'USD / Yen',      'forex',  0.001,   0.01,   9.1,  'JPY'),
  ('BTCUSDT', 'Bitcoin / USDT', 'crypto', 0.1,     1,      null, 'USDT'),
  ('ETHUSDT', 'Ethereum / USDT','crypto', 0.01,    1,      null, 'USDT')
on conflict (symbol) do nothing;
