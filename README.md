# WoW Loot Auction Bot

A Discord bot for tracking World of Warcraft guild loot auctions: raid leaders
start auctions for dropped items, members bid **in-game gold**, and officers
close and settle them. Every bid is kept forever (voids are soft), and the
ledger shows who still owes what.

> **Not for real-money trading.** This tool tracks in-game gold/trade
> settlement between guildmates only. It has no payment links, no
> marketplace, and no escrow — and never will.

## Features

- `/auction start` from a WoW **item ID** or a **raw in-game item link**
  (`|cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r`)
- Live auction card (Discord embed) with item name, item ID, Wowhead link,
  current bid, leader, and a countdown — updated publicly on every bid
- Bid via `/bid` or buttons: **+min increment**, **+500**, **+1000**, and a
  **custom bid** modal
- **Anti-snipe**: a bid in the final 20 seconds extends the auction by 30 seconds
- **Self-bid protection**: the current leader can't accidentally raise their own
  bid with quick-bid buttons (explicit `/bid` raises are allowed)
- Officer-only close/cancel/settle/void, all written to an audit log
- Full bid history per auction; voided bids are marked, never deleted
- `/ledger` per user: won items, totals owed, paid/traded status — with a
  `format:text` mode that produces a copyable plain-text report for sharing
  outside Discord (WeChat, QQ, forums, spreadsheets)
- SQLite persistence — active auctions survive bot restarts (expired ones are
  closed on startup)
- Optional **AuctionBridge** WoW addon: hover an item in game, press a
  keybinding, copy a ready-made `/auction start …` command

## Setup

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → copy the **Token** (`DISCORD_TOKEN`).
3. **General Information** → copy the **Application ID** (`DISCORD_CLIENT_ID`).
4. Invite the bot with the **bot** and **applications.commands** scopes and
   these permissions: **View Channels**, **Send Messages**, **Embed Links**,
   **Read Message History**. Invite URL template:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=84992
   ```

   No privileged gateway intents are required.

### 2. Configure and run the bot

Requires Node.js >= 22.12.

```bash
git clone <this repo> && cd wow-loot-auction-bot
npm install
cp .env.example .env   # then fill in your values
npm run deploy-commands  # registers the slash commands
npm run dev              # or: npm run build && npm start
```

### Environment variables

| Variable            | Required | Description                                                                                  |
| ------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | yes      | Bot token                                                                                     |
| `DISCORD_CLIENT_ID` | yes      | Application ID                                                                                |
| `DISCORD_GUILD_ID`  | no       | Guild to register commands in (instant). Without it commands register globally (up to 1 hour) |
| `SQLITE_PATH`       | no       | SQLite file path, default `./data/auction.db`                                                 |
| `DATABASE_URL`      | no       | Alternative to `SQLITE_PATH`; accepts `sqlite:./data/auction.db` or `file:...`                |
| `OFFICER_ROLES`     | no       | Comma-separated role names that may run officer commands. Default `Raid Leader,Auctioneer`    |
| `GAME_VERSION`      | no       | Wowhead link flavor: `classic` (default), `era`, `sod`, `tbc`, `wotlk`, `cata`, `mop`, `retail` |

### Docker (optional)

```bash
docker build -t wow-loot-auction-bot .
docker run -d --env-file .env -v auction-data:/app/data wow-loot-auction-bot
# Register slash commands once (can be run from any machine with the same env):
npm run deploy-commands
```

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/register character:<name> realm:<realm>` | anyone | Link your WoW character (required before bidding) |
| `/auction start start:<gold> min_increment:<gold> duration_minutes:<min> [item_id] [item_link] [item_name]` | officers | Start an auction. Needs at least one of `item_id`, `item_link`, `item_name` |
| `/bid auction_id:<id> amount:<gold>` | registered users | Place a bid |
| `/auction close auction_id:<id>` | officers | Close now; highest bid wins, settlement opens as `unpaid` |
| `/auction cancel auction_id:<id>` | officers | Cancel with no winner |
| `/auction history auction_id:<id>` | anyone | Full bid history (voided bids shown struck through) |
| `/auction voidbid bid_id:<id> reason:<text>` | officers | Soft-void a bid on an active auction and recompute the price |
| `/settle auction_id:<id> status:<unpaid\|paid\|traded\|cancelled>` | officers | Update settlement status |
| `/ledger [user] [format:embed\|text]` | anyone | Won auctions, total owed, settlement status. `format:text` returns a copyable plain-text report |
| `/payout` | officers | Paste final per-player gold amounts, get a formatted copyable payout report (no split math) |

"Officers" = members with one of the `OFFICER_ROLES` role names (default
**Raid Leader** or **Auctioneer**) or server administrators. All officer
actions (start/close/cancel/settle/void) and automatic closes/extensions are
written to the `audit_log` table.

### Sharing reports outside Discord

`/ledger user:@someone format:text` renders the ledger as plain text inside a
code block — no Discord mentions or markup — so it reads correctly anywhere.
On Discord mobile, tap the code block to copy it, then paste into WeChat, QQ,
guild forums, or a spreadsheet. Reports too long for one Discord message are
attached as a `.txt` file you can forward instead. Example output:

```text
Loot ledger — Bobby (Bobbo - Whitemane)
Generated 2026-06-10 14:32 UTC

#12 | Ashkandi, Greatsword of the Brotherhood | 1,500g | unpaid | 2026-06-09
#10 | Netherwind Crown | 800g | paid | 2026-06-05

Won auctions: 2
Total owed (unpaid): 1,500g
Settled (paid/traded): 800g

Settlement is in-game gold/trade only — no real-money payments.
```

### Raid payout reports (`/payout`)

For gold-split raid weeks, officers can format the final per-player numbers
into the same kind of copyable report. **The bot does no split math** — you
compute the split however your guild likes and paste one line per player per
raid into the `/payout` modal:

```text
# player | raid | base | subsidy | reason | note
Acess | SSC+TK | 283.83 | 83.48 | ranged #1 | collected by Nautile
Acess | Gruul | 8.80
包子 | SSC+TK | 0 | 41.74 | melee #2
total = 8568        # optional: expected grand total for the check line
title = Week 23     # optional report title
unit = gold         # optional in-game unit: gold (default), dkp, points
```

The bot replies with an alphabetically sorted report (zh locale-aware
collation for CJK names): per-raid subtotals kept separate per player (so
raids played by a proxy are visible), base/subsidy totals, notes under the
affected player only, and a final `Check：… ✅/❌` line verifying that
individual totals add up to the expected total. Long reports arrive as a
`.txt` attachment.

Amounts can be denominated in any **in-game** unit: `gold` (default), `dkp`,
or `points`. Real-money currencies (RMB/USD/etc.) are deliberately rejected
by the parser — the bot has no real-money denomination, payment tracking, or
split calculation. See Non-goals.

### Auction rules

- First bid must be at least the start price; later bids at least
  `current bid + min_increment`.
- A bid arriving in the final **20 seconds** extends the auction by
  **30 seconds** (repeatable).
- The current highest bidder is blocked from quick-bid buttons; an explicit
  `/bid` or custom-bid that still meets the increment is treated as a
  deliberate self-raise and allowed.
- Auctions auto-close when the timer expires; on restart the bot reloads
  active auctions from SQLite, re-arms timers, and closes anything that
  expired while it was offline.
- Bids are never deleted. Officer voids set `voided = 1` with a reason.

## AuctionBridge addon (optional)

A tiny in-game helper that turns a hovered item into a ready-to-paste
`/auction start` command. WoW addons can't write to the OS clipboard, so it
shows the command pre-selected for Ctrl+C.

**Install**

1. Copy `addon/AuctionBridge/` into your WoW AddOns folder, e.g.
   `World of Warcraft/_classic_era_/Interface/AddOns/AuctionBridge/`.
2. The `## Interface:` version in `AuctionBridge.toc` targets Classic Era; bump
   it (or enable "Load out of date AddOns") for other clients.
3. In game: **Options → Keybindings → AddOns → AuctionBridge** and bind
   "Capture hovered item for auction".

**Use**

1. Hover an item tooltip (bag, loot window, or a chat link you clicked).
2. Press your keybinding.
3. A box pops up with
   `/auction start item_link:"|cffa335ee|Hitem:19364::::::::|h[Ashkandi, ...]|h|r" start:1000 min_increment:100 duration_minutes:60`
   pre-selected — press **Ctrl+C**, then paste into Discord and adjust the
   numbers. Defaults are constants at the top of `AuctionBridge.lua`.

## Development

```bash
npm run typecheck       # tsc --noEmit
npm test                # vitest, 10 suites / 167 tests
npm run test:coverage   # tests + v8 coverage report (HTML in coverage/)
npm run dev             # run the bot with tsx
npm run build           # compile to dist/
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout, data
model, lifecycle details, and testing strategy.

### Test coverage

Coverage thresholds are enforced by `vitest.config.ts` and by CI
(`.github/workflows/ci.yml`): **99% statements/lines/functions and 96%
branches**. Current coverage is 100% statements/lines/functions and ~99%
branches. The only files excluded are the two thin entry points
(`src/bot.ts`, `src/deploy-commands.ts`, which just wire modules to the live
Discord gateway) and type-only declaration files; every command, button,
modal, timer, and service path is exercised by tests using an in-memory
SQLite database and faked Discord objects.

Layout:

```
src/
  bot.ts                 # entry point, interaction routing
  deploy-commands.ts     # slash-command registration script
  config.ts              # env handling
  commands/              # one file per slash command
  db/                    # SQLite open + schema (users, items, auctions, bids,
                         # settlements, audit_log)
  services/              # Discord-free business logic (auctions, items, audit)
  discord/               # embeds, buttons/modals, permissions, timers
  utils/wowItemParser.ts # Hitem link / item id parsing, Wowhead URLs
addon/AuctionBridge/     # the in-game helper addon
tests/                   # vitest suites
```

## Non-goals

No real-money payments, no payment links of any kind, no marketplace or
escrow, no Blizzard API dependency, no web dashboard.
