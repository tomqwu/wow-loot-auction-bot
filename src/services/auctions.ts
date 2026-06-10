import type { Db } from '../db';
import type {
  AuctionRow,
  AuctionStatus,
  BidRow,
  ItemRow,
  SettlementRow,
  SettlementStatus,
  UserRow,
} from '../db/types';
import { logAudit } from './audit';

/** A bid landing within this window before the end extends the auction. */
export const ANTI_SNIPE_WINDOW_MS = 20_000;
/** How much the auction is extended by an anti-snipe trigger. */
export const ANTI_SNIPE_EXTENSION_MS = 30_000;

export interface BidValidationInput {
  auction: Pick<
    AuctionRow,
    'status' | 'ends_at' | 'start_price' | 'min_increment' | 'current_price'
  >;
  highestBid: Pick<BidRow, 'user_id' | 'amount'> | null;
  bidderId: string;
  amount: number;
  nowMs: number;
  /**
   * Quick-bid buttons pass false so the current leader can't accidentally
   * raise their own bid. Explicit /bid amounts and the custom-bid modal pass
   * true, allowing a deliberate self-raise as long as it still meets the
   * minimum increment.
   */
  allowSelfRaise: boolean;
}

export type BidValidation = { ok: true } | { ok: false; reason: string };

export function minimumAcceptableBid(
  auction: Pick<AuctionRow, 'start_price' | 'min_increment' | 'current_price'>,
  hasBids: boolean
): number {
  return hasBids ? auction.current_price + auction.min_increment : auction.start_price;
}

export function validateBid(input: BidValidationInput): BidValidation {
  const { auction, highestBid, bidderId, amount, nowMs, allowSelfRaise } = input;
  if (auction.status !== 'active') {
    return { ok: false, reason: `This auction is ${auction.status}.` };
  }
  if (nowMs >= auction.ends_at) {
    return { ok: false, reason: 'This auction has already ended.' };
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'Bid amount must be a positive whole number of gold.' };
  }
  if (highestBid && highestBid.user_id === bidderId && !allowSelfRaise) {
    return {
      ok: false,
      reason:
        'You are already the highest bidder. Use /bid or the Custom bid button if you really want to raise your own bid.',
    };
  }
  const minimum = minimumAcceptableBid(auction, highestBid !== null);
  if (amount < minimum) {
    return { ok: false, reason: `Bid too low. Minimum acceptable bid is ${minimum}g.` };
  }
  return { ok: true };
}

/**
 * Returns the new ends_at if the bid arrived inside the anti-snipe window,
 * or null when no extension applies.
 */
export function computeAntiSnipeExtension(endsAtMs: number, nowMs: number): number | null {
  if (nowMs < endsAtMs && endsAtMs - nowMs <= ANTI_SNIPE_WINDOW_MS) {
    return endsAtMs + ANTI_SNIPE_EXTENSION_MS;
  }
  return null;
}

export function upsertUser(
  db: Db,
  discordUserId: string,
  characterName: string,
  realm: string,
  nowMs = Date.now()
): UserRow {
  db.prepare(
    `INSERT INTO users (discord_user_id, character_name, realm, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       character_name = excluded.character_name,
       realm = excluded.realm,
       updated_at = excluded.updated_at`
  ).run(discordUserId, characterName, realm, nowMs, nowMs);
  return getUser(db, discordUserId)!;
}

export function getUser(db: Db, discordUserId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(discordUserId) as
    | UserRow
    | undefined;
}

export interface CreateAuctionInput {
  itemRefId: number;
  channelId: string;
  startPrice: number;
  minIncrement: number;
  durationMinutes: number;
  createdBy: string;
  nowMs?: number;
}

export function createAuction(db: Db, input: CreateAuctionInput): AuctionRow {
  const now = input.nowMs ?? Date.now();
  const endsAt = now + input.durationMinutes * 60_000;
  const result = db
    .prepare(
      `INSERT INTO auctions
         (item_id_ref, channel_id, status, start_price, min_increment, current_price,
          ends_at, created_by, created_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.itemRefId,
      input.channelId,
      input.startPrice,
      input.minIncrement,
      input.startPrice,
      endsAt,
      input.createdBy,
      now
    );
  return getAuction(db, Number(result.lastInsertRowid))!;
}

export function getAuction(db: Db, auctionId: number): AuctionRow | undefined {
  return db.prepare('SELECT * FROM auctions WHERE id = ?').get(auctionId) as
    | AuctionRow
    | undefined;
}

export function getAuctionItem(db: Db, auction: AuctionRow): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(auction.item_id_ref) as
    | ItemRow
    | undefined;
}

export function setAuctionMessage(
  db: Db,
  auctionId: number,
  channelId: string,
  messageId: string
): void {
  db.prepare('UPDATE auctions SET channel_id = ?, message_id = ? WHERE id = ?').run(
    channelId,
    messageId,
    auctionId
  );
}

export function listActiveAuctions(db: Db): AuctionRow[] {
  return db.prepare("SELECT * FROM auctions WHERE status = 'active'").all() as AuctionRow[];
}

export function getHighestBid(db: Db, auctionId: number): BidRow | undefined {
  return db
    .prepare(
      `SELECT * FROM bids WHERE auction_id = ? AND voided = 0
       ORDER BY amount DESC, id ASC LIMIT 1`
    )
    .get(auctionId) as BidRow | undefined;
}

export function countActiveBids(db: Db, auctionId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM bids WHERE auction_id = ? AND voided = 0')
    .get(auctionId) as { n: number };
  return row.n;
}

export function getBidHistory(db: Db, auctionId: number): BidRow[] {
  return db
    .prepare('SELECT * FROM bids WHERE auction_id = ? ORDER BY id ASC')
    .all(auctionId) as BidRow[];
}

export interface PlaceBidResult {
  ok: boolean;
  reason?: string;
  bid?: BidRow;
  auction?: AuctionRow;
  /** True when the bid triggered an anti-snipe extension. */
  extended?: boolean;
}

export interface PlaceBidInput {
  auctionId: number;
  userId: string;
  amount: number;
  allowSelfRaise: boolean;
  nowMs?: number;
}

export function placeBid(db: Db, input: PlaceBidInput): PlaceBidResult {
  const now = input.nowMs ?? Date.now();
  const run = db.transaction((): PlaceBidResult => {
    const auction = getAuction(db, input.auctionId);
    if (!auction) return { ok: false, reason: `Auction #${input.auctionId} not found.` };
    const highestBid = getHighestBid(db, input.auctionId) ?? null;
    const validation = validateBid({
      auction,
      highestBid,
      bidderId: input.userId,
      amount: input.amount,
      nowMs: now,
      allowSelfRaise: input.allowSelfRaise,
    });
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const inserted = db
      .prepare(
        'INSERT INTO bids (auction_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(input.auctionId, input.userId, input.amount, now);

    const newEndsAt = computeAntiSnipeExtension(auction.ends_at, now);
    db.prepare('UPDATE auctions SET current_price = ?, ends_at = ? WHERE id = ?').run(
      input.amount,
      newEndsAt ?? auction.ends_at,
      input.auctionId
    );

    const bid = db
      .prepare('SELECT * FROM bids WHERE id = ?')
      .get(Number(inserted.lastInsertRowid)) as BidRow;
    return {
      ok: true,
      bid,
      auction: getAuction(db, input.auctionId)!,
      extended: newEndsAt !== null,
    };
  });
  return run();
}

export interface CloseAuctionResult {
  ok: boolean;
  reason?: string;
  auction?: AuctionRow;
  winningBid?: BidRow;
}

/**
 * Closes (or cancels) an auction: records the winner from the highest
 * non-voided bid, stamps closed_at, and opens an unpaid settlement when there
 * is a winner. Bid history is never deleted.
 */
export function closeAuction(
  db: Db,
  auctionId: number,
  actorUserId: string,
  options: { cancel?: boolean; nowMs?: number; auditAction?: string } = {}
): CloseAuctionResult {
  const now = options.nowMs ?? Date.now();
  const run = db.transaction((): CloseAuctionResult => {
    const auction = getAuction(db, auctionId);
    if (!auction) return { ok: false, reason: `Auction #${auctionId} not found.` };
    if (auction.status !== 'active') {
      return { ok: false, reason: `Auction #${auctionId} is already ${auction.status}.` };
    }
    const winningBid = options.cancel ? undefined : getHighestBid(db, auctionId);
    const status: AuctionStatus = options.cancel ? 'cancelled' : 'closed';
    db.prepare(
      `UPDATE auctions
       SET status = ?, winner_user_id = ?, current_price = ?, closed_at = ?
       WHERE id = ?`
    ).run(
      status,
      winningBid?.user_id ?? null,
      winningBid?.amount ?? auction.current_price,
      now,
      auctionId
    );
    if (winningBid) {
      setSettlementStatus(db, auctionId, 'unpaid', actorUserId, now);
    }
    logAudit(db, {
      action: options.auditAction ?? (options.cancel ? 'auction_cancel' : 'auction_close'),
      actorUserId,
      auctionId,
      payload: {
        winner_user_id: winningBid?.user_id ?? null,
        final_price: winningBid?.amount ?? null,
      },
      nowMs: now,
    });
    return { ok: true, auction: getAuction(db, auctionId)!, winningBid };
  });
  return run();
}

export interface VoidBidResult {
  ok: boolean;
  reason?: string;
  bid?: BidRow;
  auction?: AuctionRow;
}

/**
 * Marks a bid as voided (never deletes it) and recomputes the auction's
 * current price from the remaining non-voided bids.
 */
export function voidBid(
  db: Db,
  bidId: number,
  actorUserId: string,
  voidReason: string,
  nowMs = Date.now()
): VoidBidResult {
  const run = db.transaction((): VoidBidResult => {
    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId) as BidRow | undefined;
    if (!bid) return { ok: false, reason: `Bid #${bidId} not found.` };
    if (bid.voided) return { ok: false, reason: `Bid #${bidId} is already voided.` };
    const auction = getAuction(db, bid.auction_id)!;
    if (auction.status !== 'active') {
      return {
        ok: false,
        reason: `Auction #${auction.id} is ${auction.status}; bids can only be voided on active auctions.`,
      };
    }
    db.prepare('UPDATE bids SET voided = 1, void_reason = ? WHERE id = ?').run(voidReason, bidId);
    const highest = getHighestBid(db, bid.auction_id);
    db.prepare('UPDATE auctions SET current_price = ? WHERE id = ?').run(
      highest?.amount ?? auction.start_price,
      bid.auction_id
    );
    logAudit(db, {
      action: 'bid_void',
      actorUserId,
      auctionId: bid.auction_id,
      payload: { bid_id: bidId, bidder: bid.user_id, amount: bid.amount, reason: voidReason },
      nowMs,
    });
    return {
      ok: true,
      bid: db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId) as BidRow,
      auction: getAuction(db, bid.auction_id)!,
    };
  });
  return run();
}

export function setSettlementStatus(
  db: Db,
  auctionId: number,
  status: SettlementStatus,
  updatedBy: string,
  nowMs = Date.now()
): SettlementRow {
  db.prepare(
    `INSERT INTO settlements (auction_id, status, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(auction_id) DO UPDATE SET
       status = excluded.status,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).run(auctionId, status, updatedBy, nowMs);
  return getSettlement(db, auctionId)!;
}

export function getSettlement(db: Db, auctionId: number): SettlementRow | undefined {
  return db.prepare('SELECT * FROM settlements WHERE auction_id = ?').get(auctionId) as
    | SettlementRow
    | undefined;
}

export interface LedgerEntry {
  auction_id: number;
  item_name: string;
  final_price: number;
  closed_at: number | null;
  settlement_status: SettlementStatus;
}

export interface LedgerSummary {
  entries: LedgerEntry[];
  totalOwed: number;
  totalSettled: number;
}

/** Won auctions for a user, with settlement state and total still owed. */
export function getLedger(db: Db, userId: string): LedgerSummary {
  const entries = db
    .prepare(
      `SELECT a.id AS auction_id,
              i.item_name AS item_name,
              a.current_price AS final_price,
              a.closed_at AS closed_at,
              COALESCE(s.status, 'unpaid') AS settlement_status
       FROM auctions a
       JOIN items i ON i.id = a.item_id_ref
       LEFT JOIN settlements s ON s.auction_id = a.id
       WHERE a.winner_user_id = ? AND a.status = 'closed'
       ORDER BY a.closed_at DESC`
    )
    .all(userId) as LedgerEntry[];
  let totalOwed = 0;
  let totalSettled = 0;
  for (const entry of entries) {
    if (entry.settlement_status === 'unpaid') totalOwed += entry.final_price;
    else if (entry.settlement_status !== 'cancelled') totalSettled += entry.final_price;
  }
  return { entries, totalOwed, totalSettled };
}
