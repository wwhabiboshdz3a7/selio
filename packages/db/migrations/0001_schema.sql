-- Selio — schéma PostgreSQL (compatible Supabase Postgres). Montants en centimes entiers.
create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  is_operator boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organizations (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memberships (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','operator','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_memberships_user on memberships(user_id);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  org_id text references organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);
create index if not exists idx_sessions_user on sessions(user_id);
create index if not exists idx_sessions_expires on sessions(expires_at);

create table if not exists marketplace_connections (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('vinted','demo')),
  label text not null,
  status text not null default 'not_configured',
  capabilities jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  secret_ciphertext bytea,
  transport text not null default 'extension',
  last_sync_at timestamptz,
  last_test_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_connections_org on marketplace_connections(org_id);

create table if not exists inventory_items (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  sku text,
  title text not null,
  description text not null default '',
  brand text,
  size text,
  category text not null default 'other',
  condition text not null default 'good',
  photos jsonb not null default '[]'::jsonb,
  purchase_price_cents integer not null default 0 check (purchase_price_cents >= 0),
  purchase_fees_cents integer not null default 0 check (purchase_fees_cents >= 0),
  listed_price_cents integer check (listed_price_cents is null or listed_price_cents >= 0),
  floor_price_cents integer check (floor_price_cents is null or floor_price_cents >= 0),
  status text not null default 'in_stock' check (status in ('in_stock','listed','reserved','sold','archived')),
  connection_id text references marketplace_connections(id) on delete set null,
  external_ref text,
  external_url text,
  tags jsonb not null default '[]'::jsonb,
  purchased_at timestamptz,
  listed_at timestamptz,
  sold_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku)
);
create index if not exists idx_items_org_status on inventory_items(org_id, status);
create index if not exists idx_items_org_updated on inventory_items(org_id, updated_at desc);
create index if not exists idx_items_org_brand on inventory_items(org_id, brand);
create index if not exists idx_items_external on inventory_items(org_id, connection_id, external_ref);

create table if not exists inventory_events (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  item_id text not null references inventory_items(id) on delete cascade,
  actor_user_id text,
  kind text not null,
  changes jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_item_events_item on inventory_events(item_id, created_at desc);

create table if not exists customers (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  display_name text not null,
  handle text,
  provider text not null default 'demo',
  external_ref text,
  notes text not null default '',
  tags jsonb not null default '[]'::jsonb,
  city text,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_org on customers(org_id, last_contact_at desc);
create unique index if not exists idx_customers_handle on customers(org_id, provider, lower(handle)) where handle is not null;

create table if not exists conversations (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  item_id text references inventory_items(id) on delete set null,
  connection_id text references marketplace_connections(id) on delete set null,
  provider text not null default 'demo',
  external_ref text,
  status text not null default 'open' check (status in ('open','archived')),
  unread_count integer not null default 0,
  negotiation_rounds integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_conversations_org on conversations(org_id, status, last_message_at desc);
create unique index if not exists idx_conversations_external on conversations(org_id, provider, external_ref) where external_ref is not null;

create table if not exists messages (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  conversation_id text not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  source text not null,
  status text not null check (status in ('received','draft','pending','sent','failed')),
  body text not null,
  offer_cents integer,
  ai_request_id text,
  rule_id text,
  external_ref text,
  error text,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create unique index if not exists idx_messages_external on messages(org_id, external_ref) where external_ref is not null;

create table if not exists orders (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  item_id text not null references inventory_items(id) on delete restrict,
  customer_id text not null references customers(id) on delete restrict,
  conversation_id text references conversations(id) on delete set null,
  connection_id text references marketplace_connections(id) on delete set null,
  provider text not null default 'demo',
  external_ref text,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending','paid','shipped','delivered','completed','cancelled','refunded')),
  sale_price_cents integer not null check (sale_price_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  shipping_cost_cents integer not null default 0 check (shipping_cost_cents >= 0),
  other_costs_cents integer not null default 0 check (other_costs_cents >= 0),
  purchase_price_cents integer not null default 0,
  purchase_fees_cents integer not null default 0,
  status_history jsonb not null default '[]'::jsonb,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index if not exists idx_orders_org_created on orders(org_id, created_at desc);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_item on orders(item_id);

create table if not exists shipments (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  order_id text not null references orders(id) on delete cascade unique,
  carrier text,
  tracking_number text,
  status text not null default 'pending',
  document jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_rules (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  name text not null,
  kind text not null,
  enabled boolean not null default false,
  requires_approval boolean not null default true,
  runs_in text not null default 'server',
  schedule jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rules_org on automation_rules(org_id);

create table if not exists automation_state (
  org_id text primary key references organizations(id) on delete cascade,
  global_paused boolean not null default false,
  paused_at timestamptz
);

create table if not exists jobs (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  kind text not null,
  status text not null,
  dedupe_key text not null,
  rule_id text references automation_rules(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  runs_in text not null default 'server',
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index if not exists idx_jobs_org_status on jobs(org_id, status, created_at desc);

create table if not exists radar_searches (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  name text not null,
  criteria jsonb not null default '{}'::jsonb,
  budget_cents integer not null default 0,
  target_margin_rate numeric(6,4) not null default 0.4,
  target_margin_cents integer not null default 0,
  enabled boolean not null default true,
  provider text not null default 'demo',
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists opportunities (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  search_id text not null references radar_searches(id) on delete cascade,
  title text not null,
  observed jsonb not null,
  estimate jsonb not null,
  score integer not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_opportunities_org on opportunities(org_id, search_id, score desc);

create table if not exists purchase_requests (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  opportunity_id text not null references opportunities(id) on delete cascade,
  dedupe_key text not null,
  max_price_cents integer not null,
  budget_cents integer not null,
  status text not null default 'draft',
  checks jsonb not null default '[]'::jsonb,
  real_purchase_enabled boolean not null default false,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_purchases_org on purchase_requests(org_id, created_at desc);

create table if not exists ai_requests (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  kind text not null,
  provider text not null,
  model text not null,
  status text not null,
  conversation_id text,
  item_id text,
  prompt_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  validated boolean not null default false,
  rejection_reason text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_ai_requests_org on ai_requests(org_id, created_at desc);

create table if not exists usage_events (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  kind text not null,
  quantity integer not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_org on usage_events(org_id, created_at desc);

create table if not exists subscriptions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade unique,
  plan text not null default 'free',
  status text not null default 'none',
  provider text not null default 'none',
  external_ref text,
  stripe_customer_id text,
  current_period_end timestamptz,
  quotas jsonb not null,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotence des webhooks de paiement : un événement n'est traité qu'une fois.
create table if not exists payment_events (
  id text primary key,
  provider text not null,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null
);

create table if not exists audit_logs (
  id text primary key default gen_random_uuid()::text,
  org_id text references organizations(id) on delete cascade,
  actor_user_id text,
  action text not null,
  target_type text,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_org on audit_logs(org_id, created_at desc);

create table if not exists extension_tokens (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  label text not null,
  prefix text not null,
  secret_hash text not null,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tokens_prefix on extension_tokens(prefix);

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);
