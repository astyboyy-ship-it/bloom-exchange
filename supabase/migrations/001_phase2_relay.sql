-- Bloom Exchange, Phase 2: the non-custodial clearing relay.
--
-- The relay stores public keys, public intents, room transcripts (each move with its author's own Ed25519 request
-- signature) and dual-signed receipts in an append-only Merkle ledger. It stores no private key and no mandate:
-- only 64-hex salted commitments to mandates, which the parties sign into each receipt.

begin;

-- Agents: an identity is its raw Ed25519 public key (base64url, 43 chars).
create table agents (
  pubkey           text primary key check (pubkey ~ '^[A-Za-z0-9_-]{43}$'),
  display_name     text check (char_length(display_name) between 1 and 80),
  org              text check (char_length(org) between 1 and 120),
  domain           text check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  domain_verified  boolean not null default false,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

-- Intents: public listings. Typed terms and tags only; no free text.
create table intents (
  id               text primary key check (id ~ '^in_[0-9a-f]{24}$'),
  owner_pubkey     text not null references agents (pubkey),
  vertical         text not null check (vertical in ('api.inference', 'compute.gpu', 'data.retrieval')),
  role             text not null check (role in ('buyer', 'seller')),
  capability_tags  text[] not null default '{}' check (cardinality(capability_tags) <= 16),
  spec             jsonb not null check (jsonb_typeof(spec) = 'object' and spec ->> 'vertical' = vertical),
  status           text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_at       timestamptz not null,
  expires_at       timestamptz not null,
  check (expires_at > created_at)
);
create index intents_capability_tags_gin on intents using gin (capability_tags);
create index intents_open_idx on intents (vertical, role, expires_at, created_at desc) where status = 'OPEN';
create index intents_owner_idx on intents (owner_pubkey);

-- Rooms: one negotiation. `snapshot` is the protocol Room (packages/sdk relay-protocol.ts); the columns beside it
-- are the constrained, indexed projection of the same state.
create table rooms (
  id                 text primary key check (id ~ '^rm_[0-9a-f]{24}$'),
  intent_id          text not null references intents (id),
  vertical           text not null check (vertical in ('api.inference', 'compute.gpu', 'data.retrieval')),
  status             text not null check (status in ('PROPOSED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CLEARED')),
  buyer_pubkey       text not null references agents (pubkey),
  seller_pubkey      text not null references agents (pubkey),
  buyer_commitment   text check (buyer_commitment ~ '^[0-9a-f]{64}$'),
  seller_commitment  text check (seller_commitment ~ '^[0-9a-f]{64}$'),
  rounds             integer not null default 0 check (rounds >= 0),
  max_rounds         integer not null check (max_rounds between 1 and 20),
  seq                integer not null check (seq >= 1),
  transcript_head    text not null check (transcript_head ~ '^[0-9a-f]{64}$'),
  receipt_hash       text unique check (receipt_hash ~ '^[0-9a-f]{64}$'),
  opened_at          timestamptz not null,
  expires_at         timestamptz not null,
  updated_at         timestamptz not null default now(),
  snapshot           jsonb not null,
  check (buyer_pubkey <> seller_pubkey),
  check (rounds <= max_rounds),
  check (expires_at > opened_at),
  check ((status = 'CLEARED') = (receipt_hash is not null)),
  check (status not in ('ACCEPTED', 'CLEARED') or (buyer_commitment is not null and seller_commitment is not null))
);
create index rooms_buyer_idx on rooms (buyer_pubkey);
create index rooms_seller_idx on rooms (seller_pubkey);
create index rooms_open_expiry_idx on rooms (expires_at) where status in ('PROPOSED', 'COUNTERED');

-- Room events: the hash-chained transcript. `raw` and `auth` are the author's exact request body and signature,
-- so anyone can check every move was made by its key; `at` is kept as the exact ISO string that was hashed.
create table room_events (
  room_id    text not null references rooms (id),
  seq        integer not null check (seq >= 1),
  type       text not null check (type in ('PROPOSE', 'COUNTER', 'ACCEPT', 'REJECT', 'SIGN', 'CLEAR', 'EXPIRE')),
  actor      text not null check (actor = 'relay' or actor ~ '^[A-Za-z0-9_-]{43}$'),
  body       jsonb not null,
  raw        text,
  auth       jsonb,
  at         text not null check (at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  prev_hash  text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash       text not null check (hash ~ '^[0-9a-f]{64}$'),
  unique (room_id, seq),
  check ((type = 'EXPIRE') = (actor = 'relay')),
  check ((auth is null) = (type = 'EXPIRE'))
);

-- Receipts: append-only. Leaves of an RFC 6962 Merkle tree in `merkle_leaf_index` order.
create table receipts (
  hash               text primary key check (hash ~ '^[0-9a-f]{64}$'),
  room_id            text not null unique references rooms (id),
  body               jsonb not null,
  signatures         jsonb not null check (jsonb_typeof(signatures -> 'buyer') = 'string' and jsonb_typeof(signatures -> 'seller') = 'string'),
  buyer_pubkey       text not null references agents (pubkey),
  seller_pubkey      text not null references agents (pubkey),
  vertical           text not null,
  opened_at          timestamptz not null,
  cleared_at         timestamptz not null,
  merkle_leaf_index  bigint not null unique check (merkle_leaf_index >= 0),
  merkle_root        text not null check (merkle_root ~ '^[0-9a-f]{64}$'),
  revoked            boolean not null default false
);
create index receipts_buyer_idx on receipts (buyer_pubkey);
create index receipts_seller_idx on receipts (seller_pubkey);
create index receipts_cleared_idx on receipts (cleared_at desc);

-- Append-only: no deletes, and the only update ever allowed is revoked false -> true.
create function receipts_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'receipts are append-only';
  end if;
  if (new.hash, new.room_id, new.body, new.signatures, new.buyer_pubkey, new.seller_pubkey, new.vertical, new.opened_at, new.cleared_at, new.merkle_leaf_index, new.merkle_root)
     is distinct from
     (old.hash, old.room_id, old.body, old.signatures, old.buyer_pubkey, old.seller_pubkey, old.vertical, old.opened_at, old.cleared_at, old.merkle_leaf_index, old.merkle_root)
     or (old.revoked and not new.revoked) then
    raise exception 'receipts are append-only (only revoked may change, and only to true)';
  end if;
  return new;
end;
$$;
create trigger receipts_append_only before update or delete on receipts for each row execute function receipts_append_only();

-- Room transcripts are append-only too.
create function room_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'room events are append-only';
end;
$$;
create trigger room_events_append_only before update or delete on room_events for each row execute function room_events_append_only();

commit;
