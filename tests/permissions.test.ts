import type { Interaction } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db';
import { isOfficer, requireOfficer, requireRegistered } from '../src/discord/permissions';
import { upsertUser } from '../src/services/auctions';
import { makeMember } from './fakes';

const OFFICER_ROLES = ['Raid Leader', 'Auctioneer'];

describe('isOfficer', () => {
  it('rejects a missing member', () => {
    expect(isOfficer(null, OFFICER_ROLES)).toBe(false);
  });

  it('rejects raw API members (uncached, not a GuildMember instance)', () => {
    const apiMember = { roles: ['1', '2'], permissions: '0' };
    expect(isOfficer(apiMember as never, OFFICER_ROLES)).toBe(false);
  });

  it('accepts administrators regardless of roles', () => {
    expect(isOfficer(makeMember([], true), OFFICER_ROLES)).toBe(true);
  });

  it('matches configured role names case-insensitively', () => {
    expect(isOfficer(makeMember(['raid leader']), OFFICER_ROLES)).toBe(true);
    expect(isOfficer(makeMember(['Auctioneer']), OFFICER_ROLES)).toBe(true);
  });

  it('rejects members without a configured role', () => {
    expect(isOfficer(makeMember(['Raider', 'Healer']), OFFICER_ROLES)).toBe(false);
  });
});

describe('requireOfficer', () => {
  function fakeInteraction(member: unknown, inGuild = true): Interaction {
    return { inGuild: () => inGuild, member } as unknown as Interaction;
  }

  it('rejects use outside a guild', () => {
    const result = requireOfficer(fakeInteraction(makeMember([], true), false), OFFICER_ROLES);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('server') });
  });

  it('rejects non-officers and names the required roles', () => {
    const result = requireOfficer(fakeInteraction(makeMember(['Raider'])), OFFICER_ROLES);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Raid Leader') });
  });

  it('accepts officers', () => {
    expect(requireOfficer(fakeInteraction(makeMember(['Raid Leader'])), OFFICER_ROLES)).toEqual({
      ok: true,
    });
  });
});

describe('requireRegistered', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('rejects unregistered users with a /register hint', () => {
    const result = requireRegistered(db, 'stranger');
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('/register') });
  });

  it('accepts registered users', () => {
    upsertUser(db, 'alice', 'Alicia', 'Whitemane');
    expect(requireRegistered(db, 'alice')).toEqual({ ok: true });
  });
});
