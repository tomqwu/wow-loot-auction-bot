import 'dotenv/config';
import path from 'node:path';
import {
  CURRENCY_UNITS,
  DEFAULT_CURRENCY_UNIT,
  type CurrencyUnit,
} from './utils/format';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId?: string;
  sqlitePath: string;
  officerRoles: string[];
  gameVersion: string;
  currencyUnit: CurrencyUnit;
}

export const DEFAULT_OFFICER_ROLES = ['Raid Leader', 'Auctioneer'];

/**
 * SQLITE_PATH wins over DATABASE_URL. DATABASE_URL may carry a
 * sqlite:// / sqlite: / file: prefix, which we strip to get a filesystem path.
 */
export function resolveSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SQLITE_PATH ?? env.DATABASE_URL ?? path.join('data', 'auction.db');
  return raw.replace(/^sqlite:\/\//i, '').replace(/^sqlite:/i, '').replace(/^file:/i, '');
}

/**
 * Display unit for bids and the ledger. In-game units only; anything else
 * (e.g. fiat currency codes) is rejected at startup.
 */
export function parseCurrencyUnit(raw: string | undefined): CurrencyUnit {
  const value = raw?.trim().toLowerCase();
  if (!value) return DEFAULT_CURRENCY_UNIT;
  if (value in CURRENCY_UNITS) return value as CurrencyUnit;
  throw new Error(
    `Invalid CURRENCY_UNIT "${raw}". Supported in-game units: ${Object.keys(CURRENCY_UNITS).join(', ')}.`
  );
}

export function parseOfficerRoles(raw: string | undefined): string[] {
  const roles = (raw ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : [...DEFAULT_OFFICER_ROLES];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const token = env.DISCORD_TOKEN;
  const clientId = env.DISCORD_CLIENT_ID;
  if (!token) throw new Error('Missing required environment variable DISCORD_TOKEN');
  if (!clientId) throw new Error('Missing required environment variable DISCORD_CLIENT_ID');
  return {
    token,
    clientId,
    guildId: env.DISCORD_GUILD_ID || undefined,
    sqlitePath: resolveSqlitePath(env),
    officerRoles: parseOfficerRoles(env.OFFICER_ROLES),
    gameVersion: (env.GAME_VERSION || 'classic').toLowerCase(),
    currencyUnit: parseCurrencyUnit(env.CURRENCY_UNIT),
  };
}
