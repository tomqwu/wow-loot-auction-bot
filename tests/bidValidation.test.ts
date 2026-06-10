import { describe, expect, it } from 'vitest';
import {
  ANTI_SNIPE_EXTENSION_MS,
  ANTI_SNIPE_WINDOW_MS,
  computeAntiSnipeExtension,
  minimumAcceptableBid,
  validateBid,
  type BidValidationInput,
} from '../src/services/auctions';

const NOW = 1_750_000_000_000;

function input(overrides: Partial<BidValidationInput> = {}): BidValidationInput {
  return {
    auction: {
      status: 'active',
      ends_at: NOW + 600_000,
      start_price: 1000,
      min_increment: 100,
      current_price: 1000,
      ...(overrides.auction ?? {}),
    },
    highestBid: null,
    bidderId: 'alice',
    amount: 1000,
    nowMs: NOW,
    allowSelfRaise: false,
    ...overrides,
  };
}

describe('validateBid', () => {
  it('accepts a first bid at the start price', () => {
    expect(validateBid(input())).toEqual({ ok: true });
  });

  it('rejects a first bid below the start price', () => {
    const result = validateBid(input({ amount: 999 }));
    expect(result.ok).toBe(false);
  });

  it('requires current price + min increment once there are bids', () => {
    const base = input({
      auction: { status: 'active', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1500 },
      highestBid: { user_id: 'bob', amount: 1500 },
    });
    expect(validateBid({ ...base, amount: 1599 }).ok).toBe(false);
    expect(validateBid({ ...base, amount: 1600 }).ok).toBe(true);
  });

  it('rejects bids on closed auctions', () => {
    const result = validateBid(
      input({ auction: { status: 'closed', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1000 } })
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('closed') });
  });

  it('rejects bids on cancelled auctions', () => {
    const result = validateBid(
      input({ auction: { status: 'cancelled', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1000 } })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects bids after the auction end time even if still marked active', () => {
    const result = validateBid(
      input({ auction: { status: 'active', ends_at: NOW - 1, start_price: 1000, min_increment: 100, current_price: 1000 } })
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('ended') });
  });

  it('rejects non-positive and non-integer amounts', () => {
    expect(validateBid(input({ amount: 0 })).ok).toBe(false);
    expect(validateBid(input({ amount: -100 })).ok).toBe(false);
    expect(validateBid(input({ amount: 1000.5 })).ok).toBe(false);
  });

  it('blocks the current leader from bidding against themselves via quick bids', () => {
    const result = validateBid(
      input({
        highestBid: { user_id: 'alice', amount: 1500 },
        auction: { status: 'active', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1500 },
        amount: 1600,
        allowSelfRaise: false,
      })
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('highest bidder') });
  });

  it('allows the current leader an explicit raise that meets the increment', () => {
    const base = input({
      highestBid: { user_id: 'alice', amount: 1500 },
      auction: { status: 'active', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1500 },
      allowSelfRaise: true,
    });
    expect(validateBid({ ...base, amount: 1600 })).toEqual({ ok: true });
    // A self-raise that does not beat the increment is useless and rejected.
    expect(validateBid({ ...base, amount: 1550 }).ok).toBe(false);
  });

  it('allows other users to outbid the leader normally', () => {
    const result = validateBid(
      input({
        bidderId: 'bob',
        highestBid: { user_id: 'alice', amount: 1500 },
        auction: { status: 'active', ends_at: NOW + 600_000, start_price: 1000, min_increment: 100, current_price: 1500 },
        amount: 1600,
      })
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('minimumAcceptableBid', () => {
  const auction = { start_price: 1000, min_increment: 100, current_price: 1500 };

  it('is the start price when there are no bids', () => {
    expect(minimumAcceptableBid(auction, false)).toBe(1000);
  });

  it('is current price + increment once there are bids', () => {
    expect(minimumAcceptableBid(auction, true)).toBe(1600);
  });
});

describe('computeAntiSnipeExtension', () => {
  const endsAt = NOW + 600_000;

  it('extends by 30s when a bid lands inside the final 20s', () => {
    expect(computeAntiSnipeExtension(endsAt, endsAt - 1_000)).toBe(endsAt + ANTI_SNIPE_EXTENSION_MS);
    expect(computeAntiSnipeExtension(endsAt, endsAt - ANTI_SNIPE_WINDOW_MS)).toBe(
      endsAt + ANTI_SNIPE_EXTENSION_MS
    );
  });

  it('does not extend for earlier bids', () => {
    expect(computeAntiSnipeExtension(endsAt, endsAt - ANTI_SNIPE_WINDOW_MS - 1)).toBeNull();
  });

  it('does not extend once the auction has ended', () => {
    expect(computeAntiSnipeExtension(endsAt, endsAt)).toBeNull();
    expect(computeAntiSnipeExtension(endsAt, endsAt + 1)).toBeNull();
  });
});
