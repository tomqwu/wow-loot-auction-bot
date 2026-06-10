import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { requireOfficer } from '../discord/permissions';
import { logAudit } from '../services/audit';
import { getAuction, setSettlementStatus } from '../services/auctions';
import type { SettlementStatus } from '../db/types';
import type { BotCommand } from './types';

const STATUSES: SettlementStatus[] = ['unpaid', 'paid', 'traded', 'cancelled'];

export const settleCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('settle')
    .setDescription('Update the settlement status of a closed auction (officers only)')
    .addIntegerOption((option) =>
      option.setName('auction_id').setDescription('Auction ID').setRequired(true).setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('New settlement status')
        .setRequired(true)
        .addChoices(...STATUSES.map((status) => ({ name: status, value: status })))
    ),
  async execute(interaction, ctx) {
    const permission = requireOfficer(interaction, ctx.config.officerRoles);
    if (!permission.ok) {
      await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
      return;
    }
    const auctionId = interaction.options.getInteger('auction_id', true);
    const status = interaction.options.getString('status', true) as SettlementStatus;
    const auction = getAuction(ctx.db, auctionId);
    if (!auction) {
      await interaction.reply({
        content: `Auction #${auctionId} not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (auction.status !== 'closed' || !auction.winner_user_id) {
      await interaction.reply({
        content: `Auction #${auctionId} has no settlement to update (it must be closed with a winner).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setSettlementStatus(ctx.db, auctionId, status, interaction.user.id);
    logAudit(ctx.db, {
      action: 'settlement_update',
      actorUserId: interaction.user.id,
      auctionId,
      payload: { status },
    });
    await interaction.reply({
      content: `Settlement for auction #${auctionId} (winner <@${auction.winner_user_id}>) set to **${status}**.`,
      allowedMentions: { parse: [] },
    });
  },
};
