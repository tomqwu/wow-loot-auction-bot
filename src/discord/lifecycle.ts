import type { Client } from 'discord.js';
import type { BotConfig } from '../config';
import type { Db } from '../db';
import { logAudit } from '../services/audit';
import {
  closeAuction,
  countActiveBids,
  getAuction,
  getAuctionItem,
  getHighestBid,
  listActiveAuctions,
  placeBid,
} from '../services/auctions';
import { buildAuctionButtons, buildAuctionEmbed, formatGold } from './embeds';

export interface AppContext {
  db: Db;
  config: BotConfig;
  client: Client;
  scheduler: AuctionScheduler;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Keeps one timer per active auction and finalizes auctions when they expire.
 * resumeActiveAuctions() restores timers after a bot restart, closing anything
 * that expired while the bot was down.
 */
export class AuctionScheduler {
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(private getContext: () => AppContext) {}

  schedule(auctionId: number, endsAtMs: number): void {
    this.cancel(auctionId);
    const delay = Math.min(Math.max(endsAtMs - Date.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.timers.delete(auctionId);
      void this.onTimerFired(auctionId);
    }, delay);
    timer.unref?.();
    this.timers.set(auctionId, timer);
  }

  cancel(auctionId: number): void {
    const timer = this.timers.get(auctionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(auctionId);
    }
  }

  async resumeActiveAuctions(): Promise<void> {
    const ctx = this.getContext();
    const active = listActiveAuctions(ctx.db);
    for (const auction of active) {
      if (auction.ends_at <= Date.now()) {
        await finalizeExpiredAuction(ctx, auction.id);
      } else {
        this.schedule(auction.id, auction.ends_at);
      }
    }
    if (active.length > 0) {
      console.log(`Resumed ${active.length} active auction(s) from the database.`);
    }
  }

  private async onTimerFired(auctionId: number): Promise<void> {
    const ctx = this.getContext();
    const auction = getAuction(ctx.db, auctionId);
    if (!auction || auction.status !== 'active') return;
    if (auction.ends_at > Date.now()) {
      // ends_at moved (anti-snipe or clamped long timeout) — re-arm.
      this.schedule(auctionId, auction.ends_at);
      return;
    }
    await finalizeExpiredAuction(ctx, auctionId);
  }
}

/** Re-renders the public auction message from current database state. */
export async function refreshAuctionMessage(ctx: AppContext, auctionId: number): Promise<void> {
  const auction = getAuction(ctx.db, auctionId);
  if (!auction || !auction.message_id) return;
  const item = getAuctionItem(ctx.db, auction);
  if (!item) return;
  try {
    const channel = await ctx.client.channels.fetch(auction.channel_id);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(auction.message_id);
    await message.edit({
      embeds: [
        buildAuctionEmbed({
          auction,
          item,
          highestBid: getHighestBid(ctx.db, auctionId) ?? null,
          bidCount: countActiveBids(ctx.db, auctionId),
        }),
      ],
      components: buildAuctionButtons(auction),
    });
  } catch (error) {
    console.error(`Failed to refresh auction message for auction #${auctionId}:`, error);
  }
}

async function announceInAuctionChannel(ctx: AppContext, auctionId: number, content: string) {
  const auction = getAuction(ctx.db, auctionId);
  if (!auction) return;
  try {
    const channel = await ctx.client.channels.fetch(auction.channel_id);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send(content);
    }
  } catch (error) {
    console.error(`Failed to announce in channel for auction #${auctionId}:`, error);
  }
}

/** Auto-close path for auctions whose timer expired. */
export async function finalizeExpiredAuction(ctx: AppContext, auctionId: number): Promise<void> {
  const result = closeAuction(ctx.db, auctionId, 'system', { auditAction: 'auction_expire' });
  if (!result.ok || !result.auction) return;
  ctx.scheduler.cancel(auctionId);
  await refreshAuctionMessage(ctx, auctionId);
  const item = getAuctionItem(ctx.db, result.auction);
  const itemName = item?.item_name ?? `auction #${auctionId}`;
  await announceInAuctionChannel(
    ctx,
    auctionId,
    result.winningBid
      ? `⏰ Auction #${auctionId} (**${itemName}**) ended — won by <@${result.winningBid.user_id}> for **${formatGold(result.winningBid.amount)}**.`
      : `⏰ Auction #${auctionId} (**${itemName}**) ended with no bids.`
  );
}

export interface BidFlowResult {
  ok: boolean;
  message: string;
}

/**
 * Shared bid path for /bid, the quick-bid buttons, and the custom-bid modal:
 * validates, records the bid, applies anti-snipe extension, re-arms the
 * timer, and refreshes the public embed.
 */
export async function executeBidFlow(
  ctx: AppContext,
  input: { auctionId: number; userId: string; amount: number; allowSelfRaise: boolean }
): Promise<BidFlowResult> {
  const result = placeBid(ctx.db, input);
  if (!result.ok || !result.auction || !result.bid) {
    return { ok: false, message: result.reason ?? 'Bid failed.' };
  }
  if (result.extended) {
    ctx.scheduler.schedule(result.auction.id, result.auction.ends_at);
    logAudit(ctx.db, {
      action: 'auction_extend',
      actorUserId: 'system',
      auctionId: result.auction.id,
      payload: { new_ends_at: result.auction.ends_at, trigger_bid_id: result.bid.id },
    });
  }
  await refreshAuctionMessage(ctx, result.auction.id);
  const extendedNote = result.extended
    ? ' Your bid landed in the final 20 seconds, so the auction was extended by 30 seconds.'
    : '';
  return {
    ok: true,
    message: `Bid placed: **${formatGold(result.bid.amount)}** on auction #${result.auction.id}.${extendedNote}`,
  };
}

export interface CloseFlowResult {
  ok: boolean;
  message: string;
}

/** Shared close/cancel path for /auction close, /auction cancel, and the close button. */
export async function executeCloseFlow(
  ctx: AppContext,
  input: { auctionId: number; actorUserId: string; cancel: boolean }
): Promise<CloseFlowResult> {
  const result = closeAuction(ctx.db, input.auctionId, input.actorUserId, {
    cancel: input.cancel,
  });
  if (!result.ok || !result.auction) {
    return { ok: false, message: result.reason ?? 'Could not close the auction.' };
  }
  ctx.scheduler.cancel(input.auctionId);
  await refreshAuctionMessage(ctx, input.auctionId);
  const item = getAuctionItem(ctx.db, result.auction);
  const itemName = item?.item_name ?? `auction #${input.auctionId}`;
  if (input.cancel) {
    return { ok: true, message: `🚫 Auction #${input.auctionId} (**${itemName}**) cancelled.` };
  }
  return {
    ok: true,
    message: result.winningBid
      ? `🔨 Auction #${input.auctionId} (**${itemName}**) closed — won by <@${result.winningBid.user_id}> for **${formatGold(result.winningBid.amount)}**. Settlement opened as **unpaid**.`
      : `🔨 Auction #${input.auctionId} (**${itemName}**) closed with no bids.`,
  };
}
