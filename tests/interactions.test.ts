import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
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

  it('+500 adds 500 to the current price', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:500:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 2000 });
  });

  it('+1000 on a fresh auction bids start price + 1000', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeButtonInteraction(`bid:1000:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 2000 });
  });

  it('quick buttons never bid below the minimum when the increment exceeds the delta', async () => {
    const ctx = context();
    const auction = seedAuction(ctx, { minIncrement: 800 });
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeButtonInteraction(`bid:500:${auction.id}`);

    await handleButton(asButton(interaction), ctx);

    // current 1500 + delta 500 = 2000 < minimum 2300, so the minimum wins.
    expect(getHighestBid(ctx.db, auction.id)).toMatchObject({ amount: 2300 });
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
