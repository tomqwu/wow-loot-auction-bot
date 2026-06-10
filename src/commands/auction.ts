import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildAuctionButtons, buildAuctionEmbed, formatGold } from '../discord/embeds';
import { executeCloseFlow, refreshAuctionMessage } from '../discord/lifecycle';
import { requireOfficer } from '../discord/permissions';
import { logAudit } from '../services/audit';
import {
  createAuction,
  getAuction,
  getBidHistory,
  setAuctionMessage,
  voidBid,
} from '../services/auctions';
import { insertItem, resolveItem } from '../services/items';
import type { BotCommand } from './types';

const MAX_DURATION_MINUTES = 7 * 24 * 60;
const HISTORY_DISPLAY_LIMIT = 30;

export const auctionCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Manage loot auctions')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a loot auction (officers only)')
        .addIntegerOption((option) =>
          option
            .setName('start')
            .setDescription('Starting price in gold')
            .setRequired(true)
            .setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('min_increment')
            .setDescription('Minimum bid increment in gold')
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName('duration_minutes')
            .setDescription('Auction duration in minutes')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_DURATION_MINUTES)
        )
        .addStringOption((option) =>
          option.setName('item_id').setDescription('WoW item ID, e.g. 19364')
        )
        .addStringOption((option) =>
          option
            .setName('item_link')
            .setDescription('Raw WoW item link, e.g. |cffa335ee|Hitem:19364::::::::|h[Ashkandi]|h|r')
        )
        .addStringOption((option) =>
          option.setName('item_name').setDescription('Item name (if no ID or link)')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close an auction and record the winner (officers only)')
        .addIntegerOption((option) =>
          option.setName('auction_id').setDescription('Auction ID').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel an auction with no winner (officers only)')
        .addIntegerOption((option) =>
          option.setName('auction_id').setDescription('Auction ID').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Show the bid history of an auction')
        .addIntegerOption((option) =>
          option.setName('auction_id').setDescription('Auction ID').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('voidbid')
        .setDescription('Void a bid on an active auction (officers only)')
        .addIntegerOption((option) =>
          option.setName('bid_id').setDescription('Bid ID (see /auction history)').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Why the bid is being voided').setRequired(true).setMaxLength(200)
        )
    ),
  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'start':
        return handleStart(interaction, ctx);
      case 'close':
        return handleCloseOrCancel(interaction, ctx, false);
      case 'cancel':
        return handleCloseOrCancel(interaction, ctx, true);
      case 'history':
        return handleHistory(interaction, ctx);
      case 'voidbid':
        return handleVoidBid(interaction, ctx);
    }
  },
};

type CommandArgs = Parameters<BotCommand['execute']>;

async function handleStart(...[interaction, ctx]: CommandArgs): Promise<void> {
  const permission = requireOfficer(interaction, ctx.config.officerRoles);
  if (!permission.ok) {
    await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.channelId) {
    await interaction.reply({
      content: 'Auctions must be started in a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const resolution = resolveItem(
    {
      itemId: interaction.options.getString('item_id'),
      itemLink: interaction.options.getString('item_link'),
      itemName: interaction.options.getString('item_name'),
    },
    ctx.config.gameVersion
  );
  if (!resolution.ok) {
    await interaction.reply({ content: resolution.error, flags: MessageFlags.Ephemeral });
    return;
  }

  const item = insertItem(ctx.db, resolution.item);
  const auction = createAuction(ctx.db, {
    itemRefId: item.id,
    channelId: interaction.channelId,
    startPrice: interaction.options.getInteger('start', true),
    minIncrement: interaction.options.getInteger('min_increment', true),
    durationMinutes: interaction.options.getInteger('duration_minutes', true),
    createdBy: interaction.user.id,
  });
  logAudit(ctx.db, {
    action: 'auction_start',
    actorUserId: interaction.user.id,
    auctionId: auction.id,
    payload: {
      item_id: item.item_id,
      item_name: item.item_name,
      start_price: auction.start_price,
      min_increment: auction.min_increment,
      ends_at: auction.ends_at,
    },
  });

  await interaction.reply({
    embeds: [buildAuctionEmbed({ auction, item, highestBid: null, bidCount: 0 })],
    components: buildAuctionButtons(auction),
  });
  const message = await interaction.fetchReply();
  setAuctionMessage(ctx.db, auction.id, message.channelId, message.id);
  ctx.scheduler.schedule(auction.id, auction.ends_at);
}

async function handleCloseOrCancel(
  ...[interaction, ctx, cancel]: [...CommandArgs, boolean]
): Promise<void> {
  const permission = requireOfficer(interaction, ctx.config.officerRoles);
  if (!permission.ok) {
    await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
    return;
  }
  const result = await executeCloseFlow(ctx, {
    auctionId: interaction.options.getInteger('auction_id', true),
    actorUserId: interaction.user.id,
    cancel,
  });
  await interaction.reply(
    result.ok
      ? { content: result.message }
      : { content: result.message, flags: MessageFlags.Ephemeral }
  );
}

async function handleHistory(...[interaction, ctx]: CommandArgs): Promise<void> {
  const auctionId = interaction.options.getInteger('auction_id', true);
  const auction = getAuction(ctx.db, auctionId);
  if (!auction) {
    await interaction.reply({
      content: `Auction #${auctionId} not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const bids = getBidHistory(ctx.db, auctionId);
  if (bids.length === 0) {
    await interaction.reply({ content: `Auction #${auctionId} has no bids yet.` });
    return;
  }
  const allLines = bids.map((bid) => {
    const line = `\`#${bid.id}\` **${formatGold(bid.amount)}** — <@${bid.user_id}> — <t:${Math.floor(bid.created_at / 1000)}:f>`;
    return bid.voided ? `~~${line}~~ *(voided: ${bid.void_reason ?? 'no reason'})*` : line;
  });
  // Keep the most recent bids; Discord message content caps at 2000 characters.
  let start = Math.max(0, allLines.length - HISTORY_DISPLAY_LIMIT);
  let body = allLines.slice(start).join('\n');
  while (body.length > 1800 && start < allLines.length - 1) {
    start += 1;
    body = allLines.slice(start).join('\n');
  }
  const omitted = start;
  const header = `**Bid history for auction #${auctionId}** (${bids.length} bid${bids.length === 1 ? '' : 's'}, status: ${auction.status})`;
  const footer = omitted > 0 ? `\n*…and ${omitted} earlier bid(s) not shown.*` : '';
  await interaction.reply({
    content: `${header}\n${body}${footer}`,
    allowedMentions: { parse: [] },
  });
}

async function handleVoidBid(...[interaction, ctx]: CommandArgs): Promise<void> {
  const permission = requireOfficer(interaction, ctx.config.officerRoles);
  if (!permission.ok) {
    await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
    return;
  }
  const bidId = interaction.options.getInteger('bid_id', true);
  const reason = interaction.options.getString('reason', true);
  const result = voidBid(ctx.db, bidId, interaction.user.id, reason);
  if (!result.ok || !result.auction || !result.bid) {
    await interaction.reply({
      content: result.reason ?? 'Could not void the bid.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await refreshAuctionMessage(ctx, result.auction.id);
  await interaction.reply({
    content: `Voided bid \`#${result.bid.id}\` (${formatGold(result.bid.amount)} by <@${result.bid.user_id}>) on auction #${result.auction.id}. Current price is now ${formatGold(result.auction.current_price)}.`,
    allowedMentions: { parse: [] },
  });
}
