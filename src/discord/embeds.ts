import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { AuctionRow, BidRow, ItemRow } from '../db/types';
import { minimumAcceptableBid } from '../services/auctions';
import { formatAmount, formatGold, unitLabel, type CurrencyUnit } from '../utils/format';

const STATUS_COLORS: Record<AuctionRow['status'], number> = {
  active: 0x2ecc71,
  closed: 0xf1c40f,
  cancelled: 0x95a5a6,
};

export { formatGold };

export interface AuctionEmbedData {
  auction: AuctionRow;
  item: ItemRow;
  highestBid: BidRow | null;
  bidCount: number;
  unit: CurrencyUnit;
}

export function buildAuctionEmbed(data: AuctionEmbedData): EmbedBuilder {
  const { auction, item, highestBid, bidCount, unit } = data;
  const endsAtSec = Math.floor(auction.ends_at / 1000);
  const itemTitle = item.wowhead_url ? `[${item.item_name}](${item.wowhead_url})` : item.item_name;

  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[auction.status])
    .setTitle(`Auction #${auction.id} — ${item.item_name}`)
    .setFooter({ text: `Auction #${auction.id} • bids are ${unitLabel(unit)} only` });

  embed.addFields(
    { name: 'Item', value: itemTitle, inline: true },
    { name: 'Item ID', value: item.item_id !== null ? String(item.item_id) : '—', inline: true },
    { name: 'Status', value: auction.status, inline: true }
  );

  if (auction.status === 'active') {
    embed.addFields(
      {
        name: 'Current bid',
        value: highestBid
          ? `${formatAmount(highestBid.amount, unit)} by <@${highestBid.user_id}>`
          : `No bids yet — starts at ${formatAmount(auction.start_price, unit)}`,
        inline: true,
      },
      {
        name: 'Next minimum bid',
        value: formatAmount(minimumAcceptableBid(auction, highestBid !== null), unit),
        inline: true,
      },
      { name: 'Min increment', value: formatAmount(auction.min_increment, unit), inline: true },
      { name: 'Ends', value: `<t:${endsAtSec}:R> (<t:${endsAtSec}:f>)`, inline: true },
      { name: 'Bids', value: String(bidCount), inline: true },
      { name: 'Raid leader', value: `<@${auction.created_by}>`, inline: true }
    );
    embed.setDescription(
      `Bid with the buttons below or \`/bid auction_id:${auction.id} amount:<amount>\`.\n` +
        'A bid in the final 20 seconds extends the auction by 30 seconds.'
    );
  } else if (auction.status === 'closed') {
    embed.addFields(
      {
        name: 'Winner',
        value: auction.winner_user_id
          ? `<@${auction.winner_user_id}> at ${formatAmount(auction.current_price, unit)}`
          : 'No bids — no winner',
        inline: true,
      },
      { name: 'Bids', value: String(bidCount), inline: true },
      { name: 'Raid leader', value: `<@${auction.created_by}>`, inline: true }
    );
  } else {
    embed.addFields(
      { name: 'Result', value: 'Auction cancelled — no winner.', inline: true },
      { name: 'Raid leader', value: `<@${auction.created_by}>`, inline: true }
    );
  }

  return embed;
}

export function buildAuctionButtons(auction: AuctionRow): ActionRowBuilder<ButtonBuilder>[] {
  const disabled = auction.status !== 'active';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bid:min:${auction.id}`)
      .setLabel(`+${auction.min_increment}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bid:500:${auction.id}`)
      .setLabel('+500')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bid:1000:${auction.id}`)
      .setLabel('+1000')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bid:custom:${auction.id}`)
      .setLabel('Custom bid')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`auction:close:${auction.id}`)
      .setLabel('Close auction')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
  return [row];
}
