# Architecture

A Discord bot for tracking WoW guild loot auctions in **in-game gold**. This
document explains how the code is organized, how data flows through it, and
the reasoning behind the main design decisions.

## Module map

```
src/
  bot.ts                 Entry point: builds the Client, routes interactions,
                         resumes timers on startup, graceful shutdown
  deploy-commands.ts     One-shot script that registers slash commands
  config.ts              Environment parsing (token, db path, officer roles,
                         game version, currency unit)
  commands/              One module per slash command; each exports
                         { data: SlashCommandBuilder, execute(interaction, ctx) }
    register.ts          /register — link a WoW character
    auction.ts           /auction start|close|cancel|list|history|voidbid
    bid.ts               /bid — explicit bid by auction id
    settle.ts            /settle — settlement status updates
    ledger.ts            /ledger — won auctions and totals per user, embed or
                         copyable plain-text report (format:text)
    payout.ts            /payout — modal for pasting final per-player gold
                         amounts (no split math)
  db/
    index.ts             openDatabase(): better-sqlite3 + WAL + foreign keys
    schema.ts            Idempotent CREATE TABLE IF NOT EXISTS migrations
    types.ts             Row interfaces (snake_case, mirroring the schema)
  services/              Discord-free business logic (unit-testable)
    auctions.ts          Bid validation, anti-snipe, place/close/void/settle,
                         ledger queries, user registration
    items.ts             Item input resolution and persistence
    audit.ts             Append-only audit log
    reports.ts           Plain-text ledger reports for sharing outside Discord
    payoutReport.ts      Parser + formatter for officer-entered payout numbers
                         (formats only; computes no splits, gold amounts only)
  discord/               Everything that touches discord.js
    embeds.ts            Auction card embed + button rows
    interactions.ts      Button and modal routing
    lifecycle.ts         AppContext, AuctionScheduler (timers), embed refresh,
                         shared bid/close flows
    permissions.ts       Officer role checks, registration checks
    textReport.ts        Code-block-or-.txt-attachment reply helper
  utils/
    wowItemParser.ts     Hitem-link/id parsing, Wowhead URLs
    format.ts            Gold amount formatting (shared by services and discord)
addon/AuctionBridge/     In-game helper that copies a /auction start command
tests/                   Vitest suites + discord.js fakes (tests/fakes.ts)
```

### Layering rule

`services/` and `utils/` never import discord.js. All Discord types and side
effects live in `commands/` and `discord/`. This keeps the auction rules
directly unit-testable and means a transport other than Discord could reuse
the core without changes.

`AppContext` (`discord/lifecycle.ts`) carries `{ db, config, client,
scheduler }` and is threaded through every command and interaction handler —
there is no global state, which is what allows tests to run each case against
its own in-memory database.

## Data model

Six tables, defined in `src/db/schema.ts`. All timestamps are epoch
milliseconds (INTEGER).

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Discord user ↔ WoW character | PK `discord_user_id`; upsert on re-register |
| `items` | One row per auctioned item | `item_id` nullable (name-only auctions allowed); stores `raw_item_link` and `wowhead_url` |
| `auctions` | Auction state | `status` ∈ active/closed/cancelled; `current_price` tracks highest non-voided bid; `message_id` links the Discord embed |
| `bids` | Every bid ever placed | Append-only; `voided` + `void_reason` instead of deletion |
| `settlements` | One row per auction | `status` ∈ unpaid/paid/traded/cancelled, upserted; history of changes lives in `audit_log` |
| `audit_log` | Append-only admin/system action log | start/close/cancel/expire/extend/void/settle, with JSON payloads |

## Auction lifecycle

```
/auction start ──> active ──(officer /auction close, close button)──> closed
                     │  └──(timer expiry — auto-close)──────────────> closed
                     └──(officer /auction cancel)───────────────────> cancelled
closed + winner ──> settlement row (unpaid) ──/settle──> paid | traded | cancelled
```

- **Bid validation** (`validateBid`, pure function): auction must be active
  and not past `ends_at`; amount must be a positive integer ≥ the minimum
  (start price for the first bid, `current_price + min_increment` after).
- **Anti-snipe**: a bid landing within `ANTI_SNIPE_WINDOW_MS` (20s) of the end
  pushes `ends_at` out by `ANTI_SNIPE_EXTENSION_MS` (30s) and re-arms the
  timer. Repeatable, audited as `auction_extend`.
- **Self-bid protection**: quick-bid buttons pass `allowSelfRaise: false`, so
  the current leader can't accidentally raise their own price. Explicit
  `/bid` amounts and the custom-bid modal pass `true` — a deliberate raise is
  allowed but must still meet the increment.
- **Atomicity**: `placeBid`, `closeAuction`, and `voidBid` run inside
  better-sqlite3 transactions; the validation re-reads state inside the
  transaction so concurrent interactions can't double-apply.

### Timers and restarts

`AuctionScheduler` keeps one `setTimeout` per active auction (unref'd so they
never block shutdown, clamped to the max 32-bit delay and re-armed for very
long durations). On `ClientReady`, `resumeActiveAuctions()` reloads `status =
'active'` rows: anything already past `ends_at` is finalized immediately;
everything else is rescheduled. When a timer fires it re-checks the database —
if `ends_at` moved (anti-snipe) it re-arms instead of closing.

### Discord message updates

The auction embed is the single public source of truth. `refreshAuctionMessage`
re-renders it from the database after every state change (bid, extension,
close, cancel, void). All Discord I/O failures (deleted message, missing
channel) are caught and logged — the database state is authoritative and never
depends on a successful edit.

## Permissions

- **Officers** — members holding one of the `OFFICER_ROLES` role names
  (case-insensitive) or guild Administrator — may start, close, cancel,
  settle, and void.
- **Registered users** (any `/register`ed member) may bid.
- Role checks require a real cached `GuildMember`; raw API members are
  rejected rather than guessed at.

## Testing

`npm run test:coverage` runs 10 suites (167 tests) with v8 coverage.
Thresholds are enforced in `vitest.config.ts` (99% statements/lines/functions,
96% branches) and in CI; current coverage is 100% statements/lines/functions
across all included files.

- **Pure logic** (parser, validation, services) is tested directly against
  in-memory or temp-file SQLite databases, including a close-and-reopen
  persistence test.
- **Discord-facing code** (commands, buttons, modals, scheduler) is tested
  with lightweight fakes (`tests/fakes.ts`): hand-rolled interaction objects,
  a fake client/channel/message, and `GuildMember`s built on the real
  prototype so `instanceof` checks stay honest. Timer behavior uses vitest
  fake timers.
- **Excluded from coverage**: `src/bot.ts` and `src/deploy-commands.ts` (thin
  wiring around `client.login()`/REST registration — everything they call is
  covered) and type-only `types.ts` files, which contain no executable code.

## Non-goals

No real-money payments, payment links, marketplace, or escrow — settlement is
tracked as in-game gold/trade only. No Blizzard API dependency. No web
dashboard.
