import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFICER_ROLES,
  loadConfig,
  parseCurrencyUnit,
  parseOfficerRoles,
  resolveSqlitePath,
} from '../src/config';
import { DEFAULT_CURRENCY_UNIT } from '../src/utils/format';

const BASE_ENV = {
  DISCORD_TOKEN: 'token-123',
  DISCORD_CLIENT_ID: 'client-123',
};

describe('loadConfig', () => {
  it('throws when DISCORD_TOKEN is missing', () => {
    expect(() => loadConfig({ DISCORD_CLIENT_ID: 'x' })).toThrow(/DISCORD_TOKEN/);
  });

  it('throws when DISCORD_CLIENT_ID is missing', () => {
    expect(() => loadConfig({ DISCORD_TOKEN: 'x' })).toThrow(/DISCORD_CLIENT_ID/);
  });

  it('loads a full configuration', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DISCORD_GUILD_ID: 'guild-123',
      SQLITE_PATH: '/tmp/x.db',
      OFFICER_ROLES: 'Loot Council, Officer',
      GAME_VERSION: 'WotLK',
      CURRENCY_UNIT: 'points',
    });
    expect(config).toEqual({
      token: 'token-123',
      clientId: 'client-123',
      guildId: 'guild-123',
      sqlitePath: '/tmp/x.db',
      officerRoles: ['Loot Council', 'Officer'],
      gameVersion: 'wotlk',
      currencyUnit: 'points',
    });
  });

  it('applies defaults when optional variables are absent', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.guildId).toBeUndefined();
    expect(config.sqlitePath).toBe(path.join('data', 'auction.db'));
    expect(config.officerRoles).toEqual(DEFAULT_OFFICER_ROLES);
    expect(config.gameVersion).toBe('classic');
    expect(config.currencyUnit).toBe(DEFAULT_CURRENCY_UNIT);
  });

  it('treats an empty DISCORD_GUILD_ID as unset', () => {
    expect(loadConfig({ ...BASE_ENV, DISCORD_GUILD_ID: '' }).guildId).toBeUndefined();
  });
});

describe('resolveSqlitePath', () => {
  it('prefers SQLITE_PATH over DATABASE_URL', () => {
    expect(resolveSqlitePath({ SQLITE_PATH: 'a.db', DATABASE_URL: 'sqlite:b.db' })).toBe('a.db');
  });

  it.each([
    ['sqlite://data/x.db', 'data/x.db'],
    ['sqlite:data/x.db', 'data/x.db'],
    ['file:data/x.db', 'data/x.db'],
    ['data/x.db', 'data/x.db'],
  ])('strips the %s prefix form', (url, expected) => {
    expect(resolveSqlitePath({ DATABASE_URL: url })).toBe(expected);
  });

  it('falls back to the default path', () => {
    expect(resolveSqlitePath({})).toBe(path.join('data', 'auction.db'));
  });
});

describe('parseCurrencyUnit', () => {
  it('defaults to the bot-wide default when unset or blank', () => {
    expect(parseCurrencyUnit(undefined)).toBe(DEFAULT_CURRENCY_UNIT);
    expect(parseCurrencyUnit('   ')).toBe(DEFAULT_CURRENCY_UNIT);
  });

  it('accepts supported in-game units case-insensitively', () => {
    expect(parseCurrencyUnit('DKP')).toBe('dkp');
    expect(parseCurrencyUnit('points')).toBe('points');
    expect(parseCurrencyUnit('Gold')).toBe('gold');
  });

  it('rejects unsupported units, including fiat currencies', () => {
    expect(() => parseCurrencyUnit('rmb')).toThrow(/Invalid CURRENCY_UNIT/);
    expect(() => parseCurrencyUnit('usd')).toThrow(/in-game units/);
  });
});

describe('parseOfficerRoles', () => {
  it('splits and trims a custom list', () => {
    expect(parseOfficerRoles(' Officer ,Loot Council,, ')).toEqual(['Officer', 'Loot Council']);
  });

  it('falls back to defaults for unset or blank values', () => {
    expect(parseOfficerRoles(undefined)).toEqual(DEFAULT_OFFICER_ROLES);
    expect(parseOfficerRoles('  ,  ')).toEqual(DEFAULT_OFFICER_ROLES);
  });
});
