import { describe, expect, it } from 'vitest';
import type { AuctionRow, BidRow, ItemRow } from '../src/db/types';
import { buildAuctionButtons, buildAuctionEmbed, formatGold } from '../src/discord/embeds';

const NOW = 1_750_000_000_000;

function makeAuction(overrides: Partial<AuctionRow> = {}): AuctionRow {
  return {
    id: 7,
    item_id_ref: 1,
    channel_id: 'chan-1',
    message_id: 'msg-1',
    status: 'active',
    start_price: 1000,
    min_increment: 100,
    current_price: 1000,
    winner_user_id: null,
    ends_at: NOW + 600_000,
    created_by: 'leader',
    created_at: NOW,
    closed_at: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 1,
    game_version: 'classic',
    item_id: 19364,
    item_name: 'Ashkandi, Greatsword of the Brotherhood',
    raw_item_link: null,
    wowhead_url: 'https://www.wowhead.com/classic/item=19364',
    ...overrides,
  };
}

const HIGH_BID: BidRow = {
  id: 3,
  auction_id: 7,
  user_id: 'bob',
  amount: 1500,
  voided: 0,
  void_reason: null,
  created_at: NOW,
};

function fieldValue(embed: ReturnType<typeof buildAuctionEmbed>, name: string): string {
  const field = embed.toJSON().fields?.find((f) => f.name === name);
  if (!field) throw new Error(`Missing embed field: ${name}`);
  return field.value;
}

describe('formatGold', () => {
  it('formats with thousands separators and a gold suffix', () => {
    expect(formatGold(1500)).toBe('1,500g');
    expect(formatGold(1_500_000)).toBe('1,500,000g');
    expect(formatGold(0)).toBe('0g');
  });
});

describe('buildAuctionEmbed', () => {
  it('renders an active auction with no bids', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction(),
      item: makeItem(),
      highestBid: null,
      bidCount: 0,
    });
    const json = embed.toJSON();
    expect(json.title).toBe('Auction #7 — Ashkandi, Greatsword of the Brotherhood');
    expect(fieldValue(embed, 'Item')).toContain('https://www.wowhead.com/classic/item=19364');
    expect(fieldValue(embed, 'Item ID')).toBe('19364');
    expect(fieldValue(embed, 'Current bid')).toContain('No bids yet — starts at 1,000g');
    expect(fieldValue(embed, 'Next minimum bid')).toBe('1,000g');
    expect(fieldValue(embed, 'Ends')).toContain(`<t:${Math.floor((NOW + 600_000) / 1000)}:R>`);
    expect(json.description).toContain('/bid auction_id:7');
  });

  it('renders the current leader once there are bids', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction({ current_price: 1500 }),
      item: makeItem(),
      highestBid: HIGH_BID,
      bidCount: 2,
    });
    expect(fieldValue(embed, 'Current bid')).toBe('1,500g by <@bob>');
    expect(fieldValue(embed, 'Next minimum bid')).toBe('1,600g');
    expect(fieldValue(embed, 'Bids')).toBe('2');
  });

  it('renders an item without a wowhead link or id', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction(),
      item: makeItem({ item_id: null, wowhead_url: null, item_name: 'Mystery Loot' }),
      highestBid: null,
      bidCount: 0,
    });
    expect(fieldValue(embed, 'Item')).toBe('Mystery Loot');
    expect(fieldValue(embed, 'Item ID')).toBe('—');
  });

  it('renders a closed auction with a winner', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction({ status: 'closed', winner_user_id: 'bob', current_price: 1500 }),
      item: makeItem(),
      highestBid: HIGH_BID,
      bidCount: 2,
    });
    expect(fieldValue(embed, 'Winner')).toBe('<@bob> at 1,500g');
    expect(fieldValue(embed, 'Status')).toBe('closed');
  });

  it('renders a closed auction without bids', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction({ status: 'closed' }),
      item: makeItem(),
      highestBid: null,
      bidCount: 0,
    });
    expect(fieldValue(embed, 'Winner')).toBe('No bids — no winner');
  });

  it('renders a cancelled auction', () => {
    const embed = buildAuctionEmbed({
      auction: makeAuction({ status: 'cancelled' }),
      item: makeItem(),
      highestBid: null,
      bidCount: 1,
    });
    expect(fieldValue(embed, 'Result')).toBe('Auction cancelled — no winner.');
  });
});

describe('buildAuctionButtons', () => {
  it('builds the five bid/close buttons for an active auction', () => {
    const [row] = buildAuctionButtons(makeAuction());
    const buttons = row!.toJSON().components as Array<{
      custom_id?: string;
      label?: string;
      disabled?: boolean;
    }>;
    expect(buttons.map((b) => b.custom_id)).toEqual([
      'bid:min:7',
      'bid:500:7',
      'bid:1000:7',
      'bid:custom:7',
      'auction:close:7',
    ]);
    expect(buttons.map((b) => b.label)).toEqual(['+100', '+500', '+1000', 'Custom bid', 'Close auction']);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
  });

  it('disables all buttons once the auction is not active', () => {
    const [row] = buildAuctionButtons(makeAuction({ status: 'closed' }));
    const buttons = row!.toJSON().components as Array<{ disabled?: boolean }>;
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});
