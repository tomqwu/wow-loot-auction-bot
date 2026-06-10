import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandList, commands } from '../src/commands';
import { auctionCommand } from '../src/commands/auction';
import { bidCommand } from '../src/commands/bid';
import { ledgerCommand } from '../src/commands/ledger';
import { registerCommand } from '../src/commands/register';
import { settleCommand } from '../src/commands/settle';
import { getAuditLog } from '../src/services/audit';
import {
  closeAuction,
  getAuction,
  getBidHistory,
  getSettlement,
  getUser,
  listActiveAuctions,
  placeBid,
  upsertUser,
} from '../src/services/auctions';
import {
  asChatInput,
  ASHKANDI_LINK,
  makeChatInteraction,
  makeContext,
  makeMember,
  seedAuction,
  type TestContext,
} from './fakes';

const NOW = 1_750_000_000_000;
const OFFICER = () => makeMember(['Raid Leader']);

let contexts: TestContext[] = [];

function context(): TestContext {
  const ctx = makeContext();
  contexts.push(ctx);
  return ctx;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const ctx of contexts) {
    // Disarm any auction timers created by /auction start.
    for (const auction of listActiveAuctions(ctx.db)) ctx.scheduler.cancel(auction.id);
    ctx.db.close();
  }
  contexts = [];
  vi.restoreAllMocks();
});

describe('command registry', () => {
  it('exposes all five commands by name', () => {
    expect([...commands.keys()].sort()).toEqual(['auction', 'bid', 'ledger', 'register', 'settle']);
    expect(commandList).toHaveLength(5);
  });
});

describe('/register', () => {
  it('stores the character and confirms ephemerally', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      strings: { character: '  Alicia  ', realm: ' Whitemane ' },
    });

    await registerCommand.execute(asChatInput(interaction), ctx);

    expect(getUser(ctx.db, 'user-1')).toMatchObject({ character_name: 'Alicia', realm: 'Whitemane' });
    expect(interaction.replies[0]).toMatchObject({
      content: expect.stringContaining('Alicia'),
      flags: expect.any(Number),
    });
  });

  it('re-registering updates the stored character', async () => {
    const ctx = context();
    upsertUser(ctx.db, 'user-1', 'Oldname', 'Oldrealm');
    const interaction = makeChatInteraction({ strings: { character: 'Newname', realm: 'Newrealm' } });

    await registerCommand.execute(asChatInput(interaction), ctx);

    expect(getUser(ctx.db, 'user-1')).toMatchObject({ character_name: 'Newname', realm: 'Newrealm' });
  });

  it('rejects whitespace-only input', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({ strings: { character: '   ', realm: 'Whitemane' } });
    await registerCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('cannot be empty');
    expect(getUser(ctx.db, 'user-1')).toBeUndefined();
  });
});

describe('/bid', () => {
  it('requires registration', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeChatInteraction({ integers: { auction_id: auction.id, amount: 1000 } });
    await bidCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('/register');
  });

  it('places a bid and updates the auction', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'user-1', 'Char', 'Realm');
    const interaction = makeChatInteraction({ integers: { auction_id: auction.id, amount: 1200 } });

    await bidCommand.execute(asChatInput(interaction), ctx);

    expect(interaction.replies[0]?.content).toContain('Bid placed');
    expect(getAuction(ctx.db, auction.id)!.current_price).toBe(1200);
    expect(ctx.message.edit).toHaveBeenCalled();
  });
});

describe('/auction start', () => {
  function startInteraction(overrides: Parameters<typeof makeChatInteraction>[0] = {}) {
    return makeChatInteraction({
      subcommand: 'start',
      member: OFFICER(),
      integers: { start: 1000, min_increment: 100, duration_minutes: 60 },
      strings: { item_link: ASHKANDI_LINK },
      ...overrides,
    });
  }

  it('blocks non-officers', async () => {
    const ctx = context();
    const interaction = startInteraction({ member: makeMember(['Raider']) });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('Only officers');
    expect(listActiveAuctions(ctx.db)).toHaveLength(0);
  });

  it('requires a channel', async () => {
    const ctx = context();
    const interaction = startInteraction({ channelId: null });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('text channel');
  });

  it('rejects unresolvable items', async () => {
    const ctx = context();
    const interaction = startInteraction({ strings: {} });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('at least one of');
  });

  it('creates the auction, posts the embed, stores the message, and audits', async () => {
    const ctx = context();
    const interaction = startInteraction();

    await auctionCommand.execute(asChatInput(interaction), ctx);

    const [auction] = listActiveAuctions(ctx.db);
    expect(auction).toMatchObject({
      start_price: 1000,
      min_increment: 100,
      current_price: 1000,
      status: 'active',
      message_id: 'msg-1',
      created_by: 'user-1',
    });
    expect(interaction.replies[0]?.embeds).toHaveLength(1);
    expect(interaction.replies[0]?.components).toHaveLength(1);
    expect(getAuditLog(ctx.db, auction!.id).map((row) => row.action)).toContain('auction_start');
  });
});

describe('/auction close and cancel', () => {
  it('blocks non-officers', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeChatInteraction({
      subcommand: 'close',
      member: makeMember(['Raider']),
      integers: { auction_id: auction.id },
    });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('Only officers');
  });

  it('closes publicly with the winner', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeChatInteraction({
      subcommand: 'close',
      member: OFFICER(),
      integers: { auction_id: auction.id },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    expect(interaction.replies[0]?.content).toContain('won by <@bob>');
    expect(interaction.replies[0]?.flags).toBeUndefined();
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
  });

  it('reports failures ephemerally', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      subcommand: 'close',
      member: OFFICER(),
      integers: { auction_id: 404 },
    });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]).toMatchObject({
      content: expect.stringContaining('not found'),
      flags: expect.any(Number),
    });
  });

  it('cancels an auction', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeChatInteraction({
      subcommand: 'cancel',
      member: OFFICER(),
      integers: { auction_id: auction.id },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    expect(interaction.replies[0]?.content).toContain('cancelled');
    expect(getAuction(ctx.db, auction.id)!.status).toBe('cancelled');
  });
});

describe('/auction history', () => {
  it('reports unknown auctions', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({ subcommand: 'history', integers: { auction_id: 404 } });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('not found');
  });

  it('reports auctions without bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeChatInteraction({
      subcommand: 'history',
      integers: { auction_id: auction.id },
    });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('no bids yet');
  });

  it('lists bids with voided strikethrough and truncates long histories', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const insert = ctx.db.prepare(
      'INSERT INTO bids (auction_id, user_id, amount, voided, void_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < 35; i++) {
      const voided = i === 34 ? 1 : 0;
      insert.run(auction.id, `user-${i}`, 1000 + i * 100, voided, voided ? null : null, NOW + i);
    }
    const interaction = makeChatInteraction({
      subcommand: 'history',
      integers: { auction_id: auction.id },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    const content = interaction.replies[0]?.content ?? '';
    expect(content).toContain('35 bids');
    expect(content).toContain('~~');
    expect(content).toContain('voided: no reason');
    expect(content).toContain('5 earlier bid(s) not shown');
  });

  it('drops older bids to stay under the 2000-character message limit', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const insert = ctx.db.prepare(
      'INSERT INTO bids (auction_id, user_id, amount, voided, void_reason, created_at) VALUES (?, ?, ?, 0, NULL, ?)'
    );
    // Realistic 18-digit snowflake ids make each line long enough that 30
    // lines would overflow a Discord message.
    for (let i = 0; i < 30; i++) {
      insert.run(auction.id, `${100000000000000000n + BigInt(i)}`, 1_000_000 + i * 1000, NOW + i);
    }
    const interaction = makeChatInteraction({
      subcommand: 'history',
      integers: { auction_id: auction.id },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    const content = interaction.replies[0]?.content ?? '';
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toMatch(/…and \d+ earlier bid\(s\) not shown/);
  });

  it('shows the void reason when present', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.db
      .prepare(
        'INSERT INTO bids (auction_id, user_id, amount, voided, void_reason, created_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      .run(auction.id, 'bob', 1000, 'mis-click', NOW);
    const interaction = makeChatInteraction({
      subcommand: 'history',
      integers: { auction_id: auction.id },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    expect(interaction.replies[0]?.content).toContain('voided: mis-click');
  });
});

describe('/auction voidbid', () => {
  it('blocks non-officers', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      subcommand: 'voidbid',
      member: makeMember(['Raider']),
      integers: { bid_id: 1 },
      strings: { reason: 'x' },
    });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('Only officers');
  });

  it('reports unknown bids ephemerally', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      subcommand: 'voidbid',
      member: OFFICER(),
      integers: { bid_id: 404 },
      strings: { reason: 'oops' },
    });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]).toMatchObject({
      content: expect.stringContaining('not found'),
      flags: expect.any(Number),
    });
  });

  it('voids the bid, refreshes the embed, and reports the new price', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const bid = placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    const interaction = makeChatInteraction({
      subcommand: 'voidbid',
      member: OFFICER(),
      integers: { bid_id: bid.bid!.id },
      strings: { reason: 'entered wrong amount' },
    });

    await auctionCommand.execute(asChatInput(interaction), ctx);

    expect(getBidHistory(ctx.db, auction.id)[0]).toMatchObject({ voided: 1 });
    expect(getAuction(ctx.db, auction.id)!.current_price).toBe(1000);
    expect(interaction.replies[0]?.content).toContain('Voided bid');
    expect(ctx.message.edit).toHaveBeenCalled();
  });
});

describe('/auction with an unknown subcommand', () => {
  it('does nothing', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({ subcommand: 'mystery', member: OFFICER() });
    await auctionCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('/settle', () => {
  function settledAuction(ctx: TestContext): number {
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    closeAuction(ctx.db, auction.id, 'officer', { nowMs: NOW + 1 });
    return auction.id;
  }

  it('blocks non-officers', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      member: makeMember(['Raider']),
      integers: { auction_id: 1 },
      strings: { status: 'paid' },
    });
    await settleCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('Only officers');
  });

  it('reports unknown auctions', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({
      member: OFFICER(),
      integers: { auction_id: 404 },
      strings: { status: 'paid' },
    });
    await settleCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('not found');
  });

  it('rejects auctions without a settled winner', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const interaction = makeChatInteraction({
      member: OFFICER(),
      integers: { auction_id: auction.id },
      strings: { status: 'paid' },
    });
    await settleCommand.execute(asChatInput(interaction), ctx);
    expect(interaction.replies[0]?.content).toContain('closed with a winner');
  });

  it('updates the settlement and audits it', async () => {
    const ctx = context();
    const auctionId = settledAuction(ctx);
    const interaction = makeChatInteraction({
      member: OFFICER(),
      user: { id: 'officer-1' },
      integers: { auction_id: auctionId },
      strings: { status: 'traded' },
    });

    await settleCommand.execute(asChatInput(interaction), ctx);

    expect(getSettlement(ctx.db, auctionId)).toMatchObject({ status: 'traded', updated_by: 'officer-1' });
    expect(interaction.replies[0]?.content).toContain('**traded**');
    expect(getAuditLog(ctx.db, auctionId).map((row) => row.action)).toContain('settlement_update');
  });
});

describe('/ledger', () => {
  function embedJson(interaction: ReturnType<typeof makeChatInteraction>) {
    const embed = interaction.replies[0]?.embeds?.[0] as { toJSON: () => { title?: string; description?: string; fields?: Array<{ name: string; value: string }> } };
    return embed.toJSON();
  }

  it('shows an empty ledger for the invoking user', async () => {
    const ctx = context();
    const interaction = makeChatInteraction({});
    await ledgerCommand.execute(asChatInput(interaction), ctx);
    const json = embedJson(interaction);
    expect(json.title).toContain('Tester');
    expect(json.fields?.[0]).toMatchObject({ name: 'Won auctions', value: 'None yet.' });
  });

  it('shows won auctions, totals, and the registered character', async () => {
    const ctx = context();
    upsertUser(ctx.db, 'bob', 'Bobbo', 'Whitemane');
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    closeAuction(ctx.db, auction.id, 'officer', { nowMs: NOW + 1 });
    const interaction = makeChatInteraction({
      users: { user: { id: 'bob', username: 'bobby' } },
    });

    await ledgerCommand.execute(asChatInput(interaction), ctx);

    const json = embedJson(interaction);
    expect(json.title).toContain('bobby');
    expect(json.description).toContain('Bobbo');
    const fields = Object.fromEntries(json.fields!.map((f) => [f.name, f.value]));
    expect(fields['Won auctions (1)']).toContain('Ashkandi');
    expect(fields['Won auctions (1)']).toContain('unpaid');
    expect(fields['Total owed (unpaid)']).toBe('1,500g');
    expect(fields['Settled (paid/traded)']).toBe('0g');
  });

  it('truncates very long ledgers', async () => {
    const ctx = context();
    for (let i = 0; i < 22; i++) {
      const auction = seedAuction(ctx);
      placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1000, allowSelfRaise: true, nowMs: NOW });
      closeAuction(ctx.db, auction.id, 'officer', { nowMs: NOW + i });
    }
    const interaction = makeChatInteraction({ users: { user: { id: 'bob', username: 'bobby' } } });

    await ledgerCommand.execute(asChatInput(interaction), ctx);

    const json = embedJson(interaction);
    const won = json.fields!.find((f) => f.name.startsWith('Won auctions'))!;
    expect(won.name).toBe('Won auctions (22)');
    expect(won.value).toMatch(/…and \d+ more\./);
    expect(won.value.length).toBeLessThanOrEqual(1024);
  });
});
