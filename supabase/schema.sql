-- Selio — schema Postgres pour Supabase.
-- A executer une fois dans l'onglet "SQL Editor" de ton projet Supabase.
-- (Menu de gauche > SQL Editor > New query > coller ce fichier > Run)

create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  bio text,
  avatar_key text,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_sessions_user on sessions(user_id);

create table if not exists listings (
  id text primary key default gen_random_uuid()::text,
  seller_id text not null references users(id) on delete cascade,
  title text not null,
  description text not null,
  price_cents integer not null,
  category text not null,
  size text,
  condition text not null,
  status text not null default 'active',
  views_count integer not null default 0,
  favorites_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_listings_seller on listings(seller_id);
create index if not exists idx_listings_category on listings(category);
create index if not exists idx_listings_status on listings(status);
create index if not exists idx_listings_created on listings(created_at desc);

create table if not exists listing_images (
  id text primary key default gen_random_uuid()::text,
  listing_id text not null references listings(id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_listing_images_listing on listing_images(listing_id);

create table if not exists favorites (
  user_id text not null references users(id) on delete cascade,
  listing_id text not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists idx_favorites_listing on favorites(listing_id);

create table if not exists conversations (
  id text primary key default gen_random_uuid()::text,
  listing_id text not null references listings(id) on delete cascade,
  buyer_id text not null references users(id) on delete cascade,
  seller_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(listing_id, buyer_id)
);
create index if not exists idx_conversations_buyer on conversations(buyer_id);
create index if not exists idx_conversations_seller on conversations(seller_id);

create table if not exists messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references conversations(id) on delete cascade,
  sender_id text not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_messages_conversation on messages(conversation_id);

-- Paiement/escrow : table de reservation UNIQUEMENT, aucune transaction reelle.
-- A connecter plus tard a un vrai prestataire de paiement (ex: Stripe Connect).
create table if not exists escrow_stub (
  id text primary key default gen_random_uuid()::text,
  listing_id text not null references listings(id) on delete cascade,
  buyer_id text not null references users(id) on delete cascade,
  status text not null default 'not_connected',
  created_at timestamptz not null default now()
);

-- Important : ce backend (Netlify Functions) utilise la cle "service_role"
-- cote serveur et applique lui-meme les autorisations (comme l'ancienne
-- version). Row Level Security reste donc desactivee par defaut sur ces
-- tables — ne jamais exposer la cle service_role au navigateur.

-- =========================================================================
-- Extension "Vendeur Pro" (gestion multi-comptes, dressing, automatisation,
-- communaute). Ajoute au schema existant, ne modifie rien de l'existant.
-- =========================================================================

-- Comptes de vente connectes (Vinted etc.). Vinted n'a pas d'API publique :
-- le statut reste 'not_connected' tant qu'aucune integration officielle
-- n'existe. Ce tableau sert de point d'ancrage pour plus tard.
create table if not exists sales_accounts (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  platform text not null default 'vinted', -- 'vinted' | 'selio'
  label text not null,
  status text not null default 'not_connected', -- not_connected | connected | error
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_accounts_user on sales_accounts(user_id);

-- Dressing / stock : articles possedes par le vendeur, lies ou non a une
-- annonce Selio publiee.
create table if not exists wardrobe_items (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  title text not null,
  brand text,
  purchase_price_cents integer,
  purchase_date date,
  category text,
  status text not null default 'in_stock', -- in_stock | listed | sold | archived
  notes text,
  listing_id text references listings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wardrobe_user on wardrobe_items(user_id);
create index if not exists idx_wardrobe_listing on wardrobe_items(listing_id);

-- Ventes realisees (comptabilite). Une ligne par vente, independante du
-- statut "sold" de listings pour garder un historique meme si l'annonce
-- est ensuite modifiee/supprimee.
create table if not exists sales (
  id text primary key default gen_random_uuid()::text,
  seller_id text not null references users(id) on delete cascade,
  listing_id text references listings(id) on delete set null,
  wardrobe_item_id text references wardrobe_items(id) on delete set null,
  title text not null,
  sale_price_cents integer not null,
  platform_fee_cents integer not null default 0,
  shipping_cost_cents integer not null default 0,
  purchase_price_cents integer not null default 0,
  sold_at timestamptz not null default now(),
  buyer_username text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_seller on sales(seller_id);
create index if not exists idx_sales_sold_at on sales(sold_at desc);

-- Regles d'automatisation definies par le vendeur.
create table if not exists automation_rules (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  type text not null, -- message_on_favorite | relance | negotiation | post_sale_message | auto_relist
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_automation_rules_user on automation_rules(user_id);

-- Journal d'execution (pour afficher "ce que l'automatisation a fait").
create table if not exists automation_log (
  id text primary key default gen_random_uuid()::text,
  rule_id text not null references automation_rules(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  listing_id text references listings(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_automation_log_user on automation_log(user_id);

-- Espaces communautaires internes (equivalent "Discord" maison).
create table if not exists community_spaces (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  description text,
  created_by text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists community_members (
  space_id text not null references community_spaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'member', -- admin | member
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists community_posts (
  id text primary key default gen_random_uuid()::text,
  space_id text not null references community_spaces(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  kind text not null default 'doc', -- doc | gift | announcement
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_community_posts_space on community_posts(space_id);
