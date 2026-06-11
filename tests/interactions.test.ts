import { AttachmentBuilder, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleButton, handleModal } from '../src/discord/interactions';
import { getAuction, getHighestBid, placeBid, upsertUser } from '../src/services/auctions';
import {
  makeButtonInteraction,
  makeContext,
  makeMember,
  makeModalInteraction,
  seedAuction,
  type FakeButtonInteraction,
  type FakeModalInteraction,
  type TestContext,
} from './fakes';

const NOW = 1_750_000_000_000;

let contexts: TestContext[] = [];

function context(): TestContext {
  const ctx = makeContext();
  contexts.push(ctx);
  return ctx;
}

function asButton(interaction: FakeButtonInteraction): ButtonInteraction {
  return interaction as unknown as ButtonInteraction;
}

function asModal(interaction: FakeModalInteraction): ModalSubmitInteraction {
  return interaction as unknown as ModalSubmitInteraction;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const ctx of contexts) ctx.db.close();
  contexts = [];
  vi.restoreAllMocks();
});

describe('handleButton', () => {
  it('ignores custom ids without a numeric auction id', async () => {
    const ctx = context();
    const interaction = makeButtonInteraction('bid:min:not-a-number');
    await handleButton(asButton(interaction), ctx);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('ignores unrelated custom id scopes and actions', async () => {
    const ctx = context();
    for (const customId of ['other:thing:1', 'auction:reopen:1']) {
      const interaction = makeButtonInteraction(customId, { member: makeMember(['Raid Leader']) });
      await handleButton(asButton(interaction), ctx);
      expect(interaction.reply).not.toHaveBeenCalled();
    }
  });

  it('ignores unknown bid button actions from registered users', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction(`bid:weird:${auction.id}`);
    await handleButton(asButton(interaction), ctx);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('blocks non-officers from the close button', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeButtonInteraction(`auction:close:${auction.id}`, {
      member: makeMember(['Raider']),
    });
    await handleButton(asButton(interaction), ctx);
    expect(interaction.replies[0]).toMatchObject({
      content: expect.stringContaining('Only officers'),
      flags: expect.any(Number),
    });
    expect(getAuction(ctx.db, auction.id)!.status).toBe('active');
  });

  it('lets officers close from the button with a public reply', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`auction:close:${auction.id}`, {
      member: makeMember(['Raid Leader']),
      user: { id: 'officer-1' },
    });

    await handleButton(asButton(interaction), ctx);

    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
    expect(interaction.replies[0]?.content).toContain('won by <@bob>');
    expect(interaction.replies[0]?.flags).toBeUndefined();
  });

  it('reports close failures ephemerally', async () => {
    const ctx = context();
    const interaction = makeButtonInteraction('auction:close:404', {
      member: makeMember([], true),
    });
    await handleButton(asButton(interaction), ctx);
    expect(interaction.replies[0]).toMatchObject({
      content: expect.stringContaining('not found'),
      flags: expect.any(Number),
    });
  });

  it('opens the custom bid modal', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeButtonInteraction(`bid:custom:${auction.id}`);
    await handleButton(asButton(interaction), ctx);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0]![0] as { toJSON: () => { custom_id: string } };
    expect(modal.toJSON().custom_id).toBe(`bidmodal:${auction.id}`);
  });

  it('requires registration before quick bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeButtonInteraction(`bid:min:${auction.id}`);
    await handleButton(asButton(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('/register');
  });

  it('rejects quick bids on unknown auctions', async () => {
    const ctx = context();
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction('bid:min:404');
    await handleButton(asButton(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('not found');
  });

  it('+min bids the start price when there are no bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction(`bid:min:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ user_id: 'user-1', amount: 1000 });
    expect(interaction.replies[0]?.content).toContain('1,000g');
  });

  it('+min bids current price + increment once there are bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:min:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ user_id: 'user-1', amount: 1600 });
  });

  it('x5 adds five increments to the current price', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:x5:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    // current 1500 + 5 × increment 100 = 2000.
    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 2000 });
  });

  it('x10 on a fresh auction bids start price + ten increments', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction(`bid:x10:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 2000 });
  });

  it('quick-bid deltas scale with point-sized increments', async () => {
    const ctx = context();
    const auction = seedAuction(ctx, { startPrice: 50, minIncrement: 5 });
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 50, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:x5:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    // current 50 + 5 × increment 5 = 75.
    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 75 });
  });

  it('ignores forged quick-bid multipliers', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction(`bid:x999:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(getHighestBid(ctx.db, auction.id)).toBeUndefined();
  });

  it('blocks the current leader from quick self-bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'user-1', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:min:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(interaction.replies[0]?.content).toContain('already the highest bidder');
    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 1500 });
  });
});

describe('handleModal', () => {
  it('ignores unrelated modals and bad auction ids', async () => {
    const ctx = context();
    for (const customId of ['othermodal:1', 'bidmodal:nope']) {
      const interaction = makeModalInteraction(customId, '1500');
      await handleModal(asModal(interaction), ctx);
      expect(interaction.reply).not.toHaveBeenCalled();
    }
  });

  it('requires registration', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeModalInteraction(`bidmodal:${auction.id}`, '1500');
    await handleModal(asModal(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('/register');
  });

  it.each(['abc', '0', '-100', '12.5', '   '])('rejects invalid amount %j', async (value) => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeModalInteraction(`bidmodal:${auction.id}`, value);
    await handleModal(asModal(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('not a valid bid');
  });

  it('accepts amounts with separators and places the bid', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeModalInteraction(`bidmodal:${auction.id}`, '1,500');

    await handleModal(asModal(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ user_id: 'user-1', amount: 1500 });
    expect(interaction.replies[0]?.content).toContain('Bid placed');
  });

  it('treats modal bids as deliberate self-raises', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'user-1', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeModalInteraction(`bidmodal:${auction.id}`, '1600');

    await handleModal(asModal(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ user_id: 'user-1', amount: 1600 });
  });
});

describe('payout modal', () => {
  it('formats pasted entries into a copyable report', async () => {
    const ctx = context();
    const entries = [
      'Zhw | SSC+TK | 283.83 | 83.48 | melee #1',
      'Acess | SSC+TK | 283.83 | 83.48 | ranged #1 | collected by Nautile',
      'Acess | Gruul | 8.80',
      'total = 785.16',
    ].join('\n');
    const interaction = makeModalInteraction('payoutmodal', entries);

    await handleModal(asModal(interaction), ctx);

    const content = interaction.replies[0]!.content!;
    expect(content.startsWith('```text\n')).toBe(true);
    expect(content).toContain('Acess：376.11g');
    expect(content).toContain('Check：743.42g paid ≠ 785.16g expected ❌（difference 41.74g）');
  });

  it('reports parse errors ephemerally, truncated to ten', async () => {
    const ctx = context();
    const badLines = Array.from({ length: 12 }, (_, i) => `player${i} | raid | not-a-number`);
    const interaction = makeModalInteraction('payoutmodal', badLines.join('\n'));

    await handleModal(asModal(interaction), ctx);

    const reply = interaction.replies[0]!;
    expect(reply.content).toContain('Could not parse');
    expect(reply.content).toContain('Line 1');
    expect(reply.content).toContain('…and 2 more.');
    expect(reply.flags).toBeDefined();
  });

  it('attaches long reports as a text file', async () => {
    const ctx = context();
    const entries = Array.from(
      { length: 40 },
      (_, i) => `RaiderWithALongName${i} | SSC+TK | 283.83 | 83.48 | healer subsidy`
    ).join('\n');
    const interaction = makeModalInteraction('payoutmodal', entries);

    await handleModal(asModal(interaction), ctx);

    const reply = interaction.replies[0]!;
    expect(reply.content).toContain('attached');
    const file = reply.files?.[0] as AttachmentBuilder;
    expect(file).toBeInstanceOf(AttachmentBuilder);
    expect(file.name).toBe('payout-report.txt');
    expect((file.attachment as Buffer).toString('utf8')).toContain('Players：40');
  });
});
