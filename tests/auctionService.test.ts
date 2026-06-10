import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db';
import { getAuditLog } from '../src/services/audit';
import {
  closeAuction,
  createAuction,
  getAuction,
  getBidHistory,
  getHighestBid,
  getLedger,
  getSettlement,
  getUser,
  listActiveAuctions,
  placeBid,
  setSettlementStatus,
  upsertUser,
  voidBid,
} from '../src/services/auctions';
import { insertItem, resolveItem } from '../src/services/items';

const ASHKANDI_LINK =
  '|cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r';
const NOW = 1_750_000_000_000;

let dir: string;
let dbPath: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-test-'));
  dbPath = path.join(dir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function startAshkandiAuction(): number {
  const resolution = resolveItem({ itemLink: ASHKANDI_LINK }, 'classic');
  if (!resolution.ok) throw new Error(resolution.error);
  const item = insertItem(db, resolution.item);
  const auction = createAuction(db, {
    itemRefId: item.id,
    channelId: 'chan-1',
    startPrice: 1000,
    minIncrement: 100,
    durationMinutes: 60,
    createdBy: 'leader',
    nowMs: NOW,
  });
  return auction.id;
}

describe('item resolution', () => {
  it('resolves an item from a raw link with wowhead url', () => {
    const resolution = resolveItem({ itemLink: ASHKANDI_LINK }, 'classic');
    expect(resolution).toMatchObject({
      ok: true,
      item: {
        itemId: 19364,
        itemName: 'Ashkandi, Greatsword of the Brotherhood',
        rawItemLink: ASHKANDI_LINK,
        wowheadUrl: 'https://www.wowhead.com/classic/item=19364',
      },
    });
  });

  it('resolves an item from a bare id', () => {
    const resolution = resolveItem({ itemId: '19364' }, 'classic');
    expect(resolution).toMatchObject({
      ok: true,
      item: { itemId: 19364, itemName: 'Item 19364' },
    });
  });

  it('requires at least one identifying input', () => {
    expect(resolveItem({}, 'classic').ok).toBe(false);
  });

  it('rejects an unparseable item link', () => {
    expect(resolveItem({ itemLink: 'hello world' }, 'classic').ok).toBe(false);
  });

  it('rejects mismatched item_id and item_link', () => {
    expect(resolveItem({ itemId: '123', itemLink: ASHKANDI_LINK }, 'classic').ok).toBe(false);
  });
});

describe('auction lifecycle', () => {
  it('runs bid → outbid → close → settle and tracks the ledger', () => {
    const auctionId = startAshkandiAuction();
    upsertUser(db, 'alice', 'Alicia', 'Whitemane', NOW);
    upsertUser(db, 'bob', 'Bobbo', 'Whitemane', NOW);

    const first = placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW + 1_000 });
    expect(first.ok).toBe(true);

    const tooLow = placeBid(db, { auctionId, userId: 'bob', amount: 1050, allowSelfRaise: true, nowMs: NOW + 2_000 });
    expect(tooLow.ok).toBe(false);
    expect(tooLow.reason).toContain('1100');

    const outbid = placeBid(db, { auctionId, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW + 3_000 });
    expect(outbid.ok).toBe(true);
    expect(outbid.auction?.current_price).toBe(1500);

    const selfQuickBid = placeBid(db, { auctionId, userId: 'bob', amount: 1600, allowSelfRaise: false, nowMs: NOW + 4_000 });
    expect(selfQuickBid.ok).toBe(false);

    const closed = closeAuction(db, auctionId, 'officer', { nowMs: NOW + 5_000 });
    expect(closed.ok).toBe(true);
    expect(closed.auction).toMatchObject({
      status: 'closed',
      winner_user_id: 'bob',
      current_price: 1500,
      closed_at: NOW + 5_000,
    });
    expect(getSettlement(db, auctionId)).toMatchObject({ status: 'unpaid' });

    const lateBid = placeBid(db, { auctionId, userId: 'alice', amount: 2000, allowSelfRaise: true, nowMs: NOW + 6_000 });
    expect(lateBid.ok).toBe(false);

    expect(getLedger(db, 'bob')).toMatchObject({ totalOwed: 1500, totalSettled: 0 });

    setSettlementStatus(db, auctionId, 'paid', 'officer', NOW + 7_000);
    expect(getLedger(db, 'bob')).toMatchObject({ totalOwed: 0, totalSettled: 1500 });
    expect(getLedger(db, 'alice').entries).toHaveLength(0);

    const actions = getAuditLog(db, auctionId).map((row) => row.action);
    expect(actions).toContain('auction_close');
  });

  it('extends the auction when a bid lands in the final 20 seconds', () => {
    const auctionId = startAshkandiAuction();
    const auction = getAuction(db, auctionId)!;
    const result = placeBid(db, {
      auctionId,
      userId: 'alice',
      amount: 1000,
      allowSelfRaise: true,
      nowMs: auction.ends_at - 10_000,
    });
    expect(result.ok).toBe(true);
    expect(result.extended).toBe(true);
    expect(result.auction?.ends_at).toBe(auction.ends_at + 30_000);
  });

  it('voids a bid without deleting it and recomputes the current price', () => {
    const auctionId = startAshkandiAuction();
    placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW + 1_000 });
    const second = placeBid(db, { auctionId, userId: 'bob', amount: 2000, allowSelfRaise: true, nowMs: NOW + 2_000 });
    expect(second.ok).toBe(true);

    const voided = voidBid(db, second.bid!.id, 'officer', 'typo, meant 200', NOW + 3_000);
    expect(voided.ok).toBe(true);
    expect(voided.auction?.current_price).toBe(1000);
    expect(getHighestBid(db, auctionId)?.user_id).toBe('alice');

    const history = getBidHistory(db, auctionId);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ voided: 1, void_reason: 'typo, meant 200' });
  });

  it('cancelling records no winner and opens no settlement', () => {
    const auctionId = startAshkandiAuction();
    placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW + 1_000 });
    const cancelled = closeAuction(db, auctionId, 'officer', { cancel: true, nowMs: NOW + 2_000 });
    expect(cancelled.auction).toMatchObject({ status: 'cancelled', winner_user_id: null });
    expect(getSettlement(db, auctionId)).toBeUndefined();
    expect(getLedger(db, 'alice').entries).toHaveLength(0);
  });

  it('cannot close an auction twice', () => {
    const auctionId = startAshkandiAuction();
    expect(closeAuction(db, auctionId, 'officer').ok).toBe(true);
    expect(closeAuction(db, auctionId, 'officer').ok).toBe(false);
  });
});

describe('persistence across restarts', () => {
  it('reloads users, auctions, and bids after reopening the database file', () => {
    const auctionId = startAshkandiAuction();
    upsertUser(db, 'alice', 'Alicia', 'Whitemane', NOW);
    placeBid(db, { auctionId, userId: 'alice', amount: 1200, allowSelfRaise: true, nowMs: NOW + 1_000 });
    db.close();

    db = openDatabase(dbPath);
    expect(getUser(db, 'alice')).toMatchObject({ character_name: 'Alicia', realm: 'Whitemane' });
    const active = listActiveAuctions(db);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: auctionId, current_price: 1200, status: 'active' });
    expect(getHighestBid(db, auctionId)).toMatchObject({ user_id: 'alice', amount: 1200 });
  });
});
