import 'dotenv/config';
import path from 'node:path';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId?: string;
  sqlitePath: string;
  officerRoles: string[];
  gameVersion: string;
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
  };
}
