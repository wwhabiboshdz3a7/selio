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
