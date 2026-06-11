# Live end-to-end test runbook

Walks the full auction lifecycle against a real Discord server. Takes about
15 minutes. Use a test server, not your guild's live server.

## 1. One-time Discord setup

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → *Reset Token* → copy → `DISCORD_TOKEN`.
3. **General Information** → *Application ID* → `DISCORD_CLIENT_ID`.
4. Discord client → Settings → Advanced → enable Developer Mode; right-click
   your test server → *Copy Server ID* → `DISCORD_GUILD_ID`.
5. Invite the bot (replace `YOUR_CLIENT_ID`):

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=84992
   ```

   No privileged gateway intents are required.
6. Officer check: server admins pass automatically. Non-admin testers who
   will start/close/settle auctions need a role named `Raid Leader` or
   `Auctioneer` (or whatever `OFFICER_ROLES` is set to).

## 2. Start the bot

```bash
cp .env.example .env   # fill in the three Discord values
npm install
npm run deploy-commands  # expect: "Registered 6 slash commands in guild …"
npm run dev              # expect: "Logged in as <YourBot>#1234"
```

## 3. Test script

Run the steps in order; each has an expected outcome. Any deviation is a bug.

| # | Action | Expected |
|---|--------|----------|
| 1 | `/register character:Tester realm:Whitemane` | Ephemeral confirmation |
| 2 | `/auction start start:100 min_increment:10 duration_minutes:5 item_link:` + paste `\|cffa335ee\|Hitem:19364::::::::\|h[Ashkandi, Greatsword of the Brotherhood]\|h\|r` | Auction card: item name links to Wowhead, item ID 19364, `pts` amounts, countdown, buttons **+10 / +50 / +100 / Custom bid / Close auction** |
| 3 | Click **+10** | Ephemeral "Bid placed: **100 pts**" (first bid = start price); card updates publicly |
| 4 | Second account: `/bid auction_id:1 amount:99` before registering | Rejected: register first |
| 5 | Second account: `/register`, then `/bid auction_id:1 amount:120` | Card updates; **first bidder gets an outbid ping** in the channel |
| 6 | `/bid auction_id:1 amount:121` | Rejected: "Minimum acceptable bid is 130 pts" |
| 7 | Current leader clicks **+10** | Rejected: "already the highest bidder" |
| 8 | Current leader runs `/bid` with a higher amount | Accepted (explicit self-raise) |
| 9 | `/auction list` | Shows the open auction with current bid and time remaining |
| 10 | **Custom bid** button → modal → enter `1,000` | Accepted (separators allowed); `abc` or `-5` rejected |
| 11 | Bid within the final 20 seconds | Reply notes the **30-second anti-snipe extension**; countdown moves |
| 12 | Ctrl+C the bot mid-auction, `npm run dev` again | Log: "Resumed 1 active auction(s)"; timer still fires |
| 13 | Let it expire (or `/auction close auction_id:1`) | "⏰/🔨 … won by @user for **N pts**"; card shows winner; buttons disabled |
| 14 | `/auction history auction_id:1` | Every bid listed; any voided bids struck through |
| 15 | `/settle auction_id:1 status:paid` (officer) | Confirmation; `/ledger user:@winner` shows totals moved from owed → settled |
| 16 | `/ledger user:@winner format:text` | Copyable plain-text report in a code block |
| 17 | `/payout` (officer) → paste 2–3 `player \| raid \| base \| subsidy` lines + `total =` | Sorted report with per-raid subtotals and a `Check：… ✅` line |
| 18 | Non-officer tries `/auction close` / `/settle` / `/payout` | All rejected with the officer-roles message |

## Troubleshooting

- **Slash commands don't appear** — `npm run deploy-commands` with
  `DISCORD_GUILD_ID` set (global registration takes up to an hour); make sure
  the bot was invited with the `applications.commands` scope.
- **"Invalid CURRENCY_UNIT" on startup** — only `points`, `dkp`, `gold` are
  accepted; fiat codes are rejected by design.
- **Bot online but replies fail** — check the bot's channel permissions
  (View Channel, Send Messages, Embed Links).
- **"Only officers can do this"** — you need a `Raid Leader`/`Auctioneer`
  role (or server admin), per `OFFICER_ROLES`.
- **Data location** — SQLite file at `SQLITE_PATH` (default
  `./data/auction.db`); delete it to reset the test server's state.
