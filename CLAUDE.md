# CLAUDE.md

Discord bot for tracking WoW guild loot auctions. Members bid in **in-game
units only** — points (default), DKP, or gold via `CURRENCY_UNIT`.

## Hard project constraints

- **No real-money trading features.** No fiat denomination (RMB/USD/…),
  payment links, marketplaces, escrow, or payout split math. The
  `CURRENCY_UNITS` whitelist in `src/utils/format.ts` and the fiat rejection
  in `parseCurrencyUnit` / `parsePayoutEntries` are deliberate and must stay.
- Bids are never deleted — voids are soft (`voided = 1` + reason).
- All officer actions and automatic closes/extensions go to `audit_log`.

## Commands

```bash
npm run dev              # run the bot (requires .env)
npm run deploy-commands  # register slash commands (instant when DISCORD_GUILD_ID is set)
npm test                 # vitest suites
npm run test:coverage    # CI gate: 99% stmts/lines/funcs, 96% branches (vitest.config.ts)
npm run typecheck        # tsc --noEmit
npm run build            # compile to dist/
```

## Environment

Copy `.env.example` → `.env`. Required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`.
Strongly recommended for development: `DISCORD_GUILD_ID` (guild-scoped command
registration is instant; global takes up to an hour). Optional: `SQLITE_PATH`
or `DATABASE_URL`, `OFFICER_ROLES` (default `Raid Leader,Auctioneer`),
`GAME_VERSION` (Wowhead link flavor), `CURRENCY_UNIT` (`points` | `dkp` |
`gold`; fiat codes fail startup on purpose).

## Architecture

See `docs/ARCHITECTURE.md` for the module map, data model, and lifecycle.
Layering rule: `src/services/` and `src/utils/` never import discord.js — all
Discord side effects live in `src/commands/` and `src/discord/`. Keep new
business logic in services so it stays unit-testable.

## Live end-to-end testing

`docs/E2E_TEST.md` is the step-by-step runbook for testing against a real
Discord server (setup, the full bid → close → settle → report flow, and
troubleshooting). Use it when asked to verify the bot live.

## Testing expectations

Coverage thresholds are enforced by CI (`.github/workflows/ci.yml`); new code
needs tests. Discord objects are faked via `tests/fakes.ts` (in-memory SQLite
`AppContext`, fake interactions/members) — follow the existing patterns in
`tests/commands.test.ts` and `tests/interactions.test.ts`.
