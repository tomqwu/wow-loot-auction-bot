import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db';
import { getAuditLog, logAudit } from '../src/services/audit';
import {
  closeAuction,
  createAuction,
  getLedger,
  placeBid,
  setSettlementStatus,
  upsertUser,
  voidBid,
} from '../src/services/auctions';
import { insertItem, resolveItem } from '../src/services/items';

const ASHKANDI_LINK =
  '|cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r';
const NOW = 1_750_000_000_000;

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function startAuction(): number {
  const resolution = resolveItem({ itemLink: ASHKANDI_LINK }, 'classic');
  if (!resolution.ok) throw new Error(resolution.error);
  const item = insertItem(db, resolution.item);
  return createAuction(db, {
    itemRefId: item.id,
    channelId: 'chan-1',
    startPrice: 1000,
    minIncrement: 100,
    durationMinutes: 60,
    createdBy: 'leader',
    nowMs: NOW,
  }).id;
}

describe('placeBid edge cases', () => {
  it('rejects bids on unknown auctions', () => {
    const result = placeBid(db, { auctionId: 404, userId: 'alice', amount: 1000, allowSelfRaise: true });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('not found') });
  });

  it('uses the current time by default', () => {
    const auctionId = startAuction();
    // Default nowMs (Date.now()) is far past the seeded ends_at, so this is rejected.
    const result = placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('ended') });
  });
});

describe('closeAuction edge cases', () => {
  it('rejects unknown auctions', () => {
    expect(closeAuction(db, 404, 'officer')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not found'),
    });
  });
});

describe('voidBid edge cases', () => {
  it('rejects unknown bids', () => {
    expect(voidBid(db, 404, 'officer', 'x')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not found'),
    });
  });

  it('rejects double voids', () => {
    const auctionId = startAuction();
    const bid = placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW });
    expect(voidBid(db, bid.bid!.id, 'officer', 'first').ok).toBe(true);
    expect(voidBid(db, bid.bid!.id, 'officer', 'second')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('already voided'),
    });
  });

  it('rejects voiding bids on closed auctions', () => {
    const auctionId = startAuction();
    const bid = placeBid(db, { auctionId, userId: 'alice', amount: 1000, allowSelfRaise: true, nowMs: NOW });
    closeAuction(db, auctionId, 'officer', { nowMs: NOW + 1 });
    expect(voidBid(db, bid.bid!.id, 'officer', 'late')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('closed'),
    });
  });
});

describe('ledger settlement states', () => {
  it('excludes cancelled settlements from both owed and settled totals', () => {
    const auctionId = startAuction();
    placeBid(db, { auctionId, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    closeAuction(db, auctionId, 'officer', { nowMs: NOW + 1 });
    setSettlementStatus(db, auctionId, 'cancelled', 'officer', NOW + 2);

    const ledger = getLedger(db, 'bob');
    expect(ledger.entries[0]).toMatchObject({ settlement_status: 'cancelled' });
    expect(ledger.totalOwed).toBe(0);
    expect(ledger.totalSettled).toBe(0);
  });

  it('counts traded settlements as settled', () => {
    const auctionId = startAuction();
    placeBid(db, { auctionId, userId: 'bob', amount: 1500, allowSelfRaise: true, nowMs: NOW });
    closeAuction(db, auctionId, 'officer', { nowMs: NOW + 1 });
    setSettlementStatus(db, auctionId, 'traded', 'officer', NOW + 2);

    expect(getLedger(db, 'bob')).toMatchObject({ totalOwed: 0, totalSettled: 1500 });
  });
});

describe('users', () => {
  it('upsertUser updates in place without duplicating rows', () => {
    upsertUser(db, 'alice', 'First', 'RealmA', NOW);
    const updated = upsertUser(db, 'alice', 'Second', 'RealmB', NOW + 1);
    expect(updated).toMatchObject({
      character_name: 'Second',
      realm: 'RealmB',
      created_at: NOW,
      updated_at: NOW + 1,
    });
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('upsertUser defaults timestamps to now', () => {
    const before = Date.now();
    const user = upsertUser(db, 'bob', 'Bobbo', 'Whitemane');
    expect(user.created_at).toBeGreaterThanOrEqual(before);
  });
});

describe('audit log', () => {
  it('stores payloads as JSON and defaults timestamps', () => {
    const before = Date.now();
    logAudit(db, { action: 'with_payload', actorUserId: 'a', auctionId: 1, payload: { x: 1 } });
    logAudit(db, { action: 'without_payload', actorUserId: 'a' });

    const rows = getAuditLog(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'with_payload', payload_json: '{"x":1}' });
    expect(rows[0]!.created_at).toBeGreaterThanOrEqual(before);

    const orphan = db
      .prepare("SELECT * FROM audit_log WHERE action = 'without_payload'")
      .get() as { auction_id: number | null; payload_json: string | null };
    expect(orphan).toMatchObject({ auction_id: null, payload_json: null });
  });
});
