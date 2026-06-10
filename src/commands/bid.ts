import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { executeBidFlow } from '../discord/lifecycle';
import { requireRegistered } from '../discord/permissions';
import type { BotCommand } from './types';

export const bidCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('bid')
    .setDescription('Place a bid on a loot auction (amount in gold)')
    .addIntegerOption((option) =>
      option.setName('auction_id').setDescription('Auction ID').setRequired(true).setMinValue(1)
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Bid amount in gold')
        .setRequired(true)
        .setMinValue(1)
    ),
  async execute(interaction, ctx) {
    const registration = requireRegistered(ctx.db, interaction.user.id);
    if (!registration.ok) {
      await interaction.reply({ content: registration.message, flags: MessageFlags.Ephemeral });
      return;
    }
    const result = await executeBidFlow(ctx, {
      auctionId: interaction.options.getInteger('auction_id', true),
      userId: interaction.user.id,
      amount: interaction.options.getInteger('amount', true),
      allowSelfRaise: true,
    });
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
  },
};
