import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeBidFlow,
  executeCloseFlow,
  finalizeExpiredAuction,
  refreshAuctionMessage,
} from '../src/discord/lifecycle';
import { getAuditLog } from '../src/services/audit';
import { getAuction, getSettlement, placeBid, upsertUser } from '../src/services/auctions';
import { makeContext, makeFakeClient, seedAuction, type TestContext } from './fakes';

const NOW = 1_750_000_000_000;

let contexts: TestContext[] = [];

function context(overrides: Parameters<typeof makeContext>[0] = {}): TestContext {
  const ctx = makeContext(overrides);
  contexts.push(ctx);
  return ctx;
}

/** Detaches the auction from its item row to exercise missing-item guards. */
function corruptItemRef(ctx: TestContext, auctionId: number): void {
  ctx.db.pragma('foreign_keys = OFF');
  ctx.db.prepare('UPDATE auctions SET item_id_ref = 9999 WHERE id = ?').run(auctionId);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const ctx of contexts) ctx.db.close();
  contexts = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuctionScheduler', () => {
  it('auto-closes the auction when its timer expires', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW });
    ctx.scheduler.schedule(auction.id, auction.ends_at);

    await vi.advanceTimersByTimeAsync(auction.ends_at - NOW + 1);

    const closed = getAuction(ctx.db, auction.id)!;
    expect(closed.status).toBe('closed');
    expect(closed.winner_user_id).toBe('alice');
    expect(getSettlement(ctx.db, auction.id)).toMatchObject({ status: 'unpaid' });
    expect(ctx.message.edit).toHaveBeenCalled();
    expect(ctx.channel.send).toHaveBeenCalledWith(expect.stringContaining('won by <@alice>'));
    expect(getAuditLog(ctx.db, auction.id).map((row) => row.action)).toContain('auction_expire');
  });

  it('announces no-bid expiries', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.scheduler.schedule(auction.id, auction.ends_at);

    await vi.advanceTimersByTimeAsync(auction.ends_at - NOW + 1);

    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
    expect(ctx.channel.send).toHaveBeenCalledWith(expect.stringContaining('ended with no bids'));
  });

  it('re-arms instead of closing when ends_at moved into the future', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.scheduler.schedule(auction.id, auction.ends_at);

    const newEndsAt = auction.ends_at + 120_000;
    ctx.db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(newEndsAt, auction.id);

    await vi.advanceTimersByTimeAsync(auction.ends_at - NOW + 1);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('active');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
  });

  it('does nothing when the timer fires for an already-closed auction', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.scheduler.schedule(auction.id, auction.ends_at);
    await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: false });
    ctx.scheduler.schedule(auction.id, auction.ends_at);

    ctx.channel.send.mockClear();
    await vi.advanceTimersByTimeAsync(auction.ends_at - NOW + 1);
    expect(ctx.channel.send).not.toHaveBeenCalled();
  });

  it('does nothing when the timer fires for a missing auction', async () => {
    const ctx = context();
    ctx.scheduler.schedule(999, NOW + 1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ctx.channel.send).not.toHaveBeenCalled();
  });

  it('cancel() disarms a scheduled timer', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.scheduler.schedule(auction.id, auction.ends_at);
    ctx.scheduler.cancel(auction.id);
    ctx.scheduler.cancel(auction.id); // second cancel is a no-op

    await vi.advanceTimersByTimeAsync(auction.ends_at - NOW + 1);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('active');
  });

  it('resumes active auctions on restart and closes expired ones immediately', async () => {
    const ctx = context();
    const expired = seedAuction(ctx, { nowMs: NOW - 7_200_000, durationMinutes: 60 });
    const running = seedAuction(ctx, { nowMs: NOW, durationMinutes: 60 });

    await ctx.scheduler.resumeActiveAuctions();

    expect(getAuction(ctx.db, expired.id)!.status).toBe('closed');
    expect(getAuction(ctx.db, running.id)!.status).toBe('active');

    await vi.advanceTimersByTimeAsync(3_600_001);
    expect(getAuction(ctx.db, running.id)!.status).toBe('closed');
  });

  it('resume is a no-op without active auctions', async () => {
    const ctx = context();
    await ctx.scheduler.resumeActiveAuctions();
    expect(ctx.channel.send).not.toHaveBeenCalled();
  });
});

describe('refreshAuctionMessage', () => {
  it('skips auctions without a posted message', async () => {
    const ctx = context();
    const auction = seedAuction(ctx, { withMessage: false });
    await refreshAuctionMessage(ctx, auction.id);
    expect(ctx.message.edit).not.toHaveBeenCalled();
  });

  it('skips auctions whose item row is missing', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    corruptItemRef(ctx, auction.id);
    await refreshAuctionMessage(ctx, auction.id);
    expect(ctx.message.edit).not.toHaveBeenCalled();
  });

  it('skips non-text channels', async () => {
    const ctx = context({ channel: { isTextBased: () => false } });
    const auction = seedAuction(ctx);
    await refreshAuctionMessage(ctx, auction.id);
    expect(ctx.message.edit).not.toHaveBeenCalled();
  });

  it('skips text-like channels without a message store', async () => {
    const ctx = context({ channel: { isTextBased: () => true } });
    const auction = seedAuction(ctx);
    await refreshAuctionMessage(ctx, auction.id);
    expect(ctx.message.edit).not.toHaveBeenCalled();
  });

  it('survives channel fetch failures', async () => {
    const ctx = context({
      client: { channels: { fetch: vi.fn(async () => Promise.reject(new Error('boom'))) } } as never,
    });
    const auction = seedAuction(ctx);
    await refreshAuctionMessage(ctx, auction.id);
    expect(console.error).toHaveBeenCalled();
  });

  it('survives message fetch failures', async () => {
    const ctx = context();
    ctx.channel.messages.fetch.mockRejectedValueOnce(new Error('gone'));
    const auction = seedAuction(ctx);
    await refreshAuctionMessage(ctx, auction.id);
    expect(ctx.message.edit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('finalizeExpiredAuction', () => {
  it('returns silently when the auction is already closed', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: false });
    ctx.channel.send.mockClear();
    await finalizeExpiredAuction(ctx, auction.id);
    expect(ctx.channel.send).not.toHaveBeenCalled();
  });

  it('falls back to the auction id when the item row is missing', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    corruptItemRef(ctx, auction.id);
    await finalizeExpiredAuction(ctx, auction.id);
    expect(ctx.channel.send).toHaveBeenCalledWith(expect.stringContaining(`auction #${auction.id}`));
  });

  it('skips the announcement when the channel cannot send', async () => {
    const ctx = context({
      channel: { isTextBased: () => true, messages: { fetch: vi.fn(async () => undefined) } },
    });
    const auction = seedAuction(ctx, { withMessage: false });
    await finalizeExpiredAuction(ctx, auction.id);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
  });

  it('skips the announcement when the channel cannot be resolved', async () => {
    const ctx = context({ channel: null });
    const auction = seedAuction(ctx, { withMessage: false });
    await finalizeExpiredAuction(ctx, auction.id);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
  });

  it('logs announcement failures', async () => {
    const failingClient = makeFakeClient(null);
    (failingClient.channels.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const ctx = context({ client: failingClient });
    const auction = seedAuction(ctx, { withMessage: false });
    await finalizeExpiredAuction(ctx, auction.id);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('executeBidFlow', () => {
  it('returns validation failures verbatim', async () => {
    const ctx = context();
    const result = await executeBidFlow(ctx, {
      auctionId: 42,
      userId: 'alice',
      amount: 1000,
      allowSelfRaise: true,
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
  });

  it('places a bid and refreshes the embed', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'alice', 'Alicia', 'Whitemane');

    const result = await executeBidFlow(ctx, {
      auctionId: auction.id,
      userId: 'alice',
      amount: 1200,
      allowSelfRaise: true,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('1,200g');
    expect(result.message).not.toContain('extended');
    expect(ctx.message.edit).toHaveBeenCalled();
    expect(getAuction(ctx.db, auction.id)!.current_price).toBe(1200);
  });

  it('pings the displaced leader when a different user outbids them', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'alice', 'Alicia', 'Whitemane');
    upsertUser(ctx.db, 'bob', 'Bobbo', 'Whitemane');
    await executeBidFlow(ctx, { auctionId: auction.id, userId: 'alice', amount: 1000, allowSelfRaise: true });
    ctx.channel.send.mockClear();

    await executeBidFlow(ctx, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true });

    expect(ctx.channel.send).toHaveBeenCalledWith(
      expect.stringContaining("<@alice> you've been outbid")
    );
    expect(ctx.channel.send).toHaveBeenCalledWith(expect.stringContaining('1,500g'));
  });

  it('does not ping on a self-raise by the current leader', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    upsertUser(ctx.db, 'alice', 'Alicia', 'Whitemane');
    await executeBidFlow(ctx, { auctionId: auction.id, userId: 'alice', amount: 1000, allowSelfRaise: true });
    ctx.channel.send.mockClear();

    await executeBidFlow(ctx, { auctionId: auction.id, userId: 'alice', amount: 1200, allowSelfRaise: true });

    expect(ctx.channel.send).not.toHaveBeenCalled();
  });

  it('extends, re-arms the timer, and audits anti-snipe bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    ctx.scheduler.schedule(auction.id, auction.ends_at);
    vi.setSystemTime(auction.ends_at - 10_000);

    const result = await executeBidFlow(ctx, {
      auctionId: auction.id,
      userId: 'alice',
      amount: 1000,
      allowSelfRaise: true,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('extended by 30 seconds');
    const updated = getAuction(ctx.db, auction.id)!;
    expect(updated.ends_at).toBe(auction.ends_at + 30_000);
    expect(getAuditLog(ctx.db, auction.id).map((row) => row.action)).toContain('auction_extend');

    // The original deadline passes without closing; the extended one closes.
    await vi.advanceTimersByTimeAsync(10_000 + 1);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('active');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getAuction(ctx.db, auction.id)!.status).toBe('closed');
  });
});

describe('executeCloseFlow', () => {
  it('reports closing failures', async () => {
    const ctx = context();
    const result = await executeCloseFlow(ctx, { auctionId: 42, actorUserId: 'officer', cancel: false });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
  });

  it('closes with a winner and opens a settlement', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });

    const result = await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: false });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('won by <@bob>');
    expect(result.message).toContain('unpaid');
    expect(getSettlement(ctx.db, auction.id)).toMatchObject({ status: 'unpaid' });
    expect(ctx.message.edit).toHaveBeenCalled();
  });

  it('closes without bids', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    const result = await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: false });
    expect(result.message).toContain('closed with no bids');
  });

  it('cancels with no winner', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    placeBid(ctx.db, { auctionId: auction.id, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });

    const result = await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: true });

    expect(result.message).toContain('cancelled');
    expect(getAuction(ctx.db, auction.id)).toMatchObject({ status: 'cancelled', winner_user_id: null });
    expect(getSettlement(ctx.db, auction.id)).toBeUndefined();
  });

  it('falls back to the auction id when the item row is missing', async () => {
    const ctx = context();
    const auction = seedAuction(ctx);
    corruptItemRef(ctx, auction.id);
    const result = await executeCloseFlow(ctx, { auctionId: auction.id, actorUserId: 'officer', cancel: false });
    expect(result.message).toContain(`auction #${auction.id}`);
  });
});
