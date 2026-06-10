import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { requireOfficer } from '../discord/permissions';
import type { BotCommand } from './types';

export const PAYOUT_MODAL_ID = 'payoutmodal';

/**
 * Opens a paste box for final per-player gold amounts and replies with a
 * formatted, copyable payout report. The bot does not compute splits and
 * amounts are in-game gold only — no real-money payment support.
 */
export const payoutCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Format final per-player gold payouts into a copyable report (officers only)'),
  async execute(interaction, ctx) {
    const permission = requireOfficer(interaction, ctx.config.officerRoles);
    if (!permission.ok) {
      await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(PAYOUT_MODAL_ID)
      .setTitle('Payout report (in-game gold)')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('entries')
            .setLabel('One line per player per raid')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('player | raid | base | subsidy | reason | note')
            .setRequired(true)
            .setMaxLength(4000)
        )
      );
    await interaction.showModal(modal);
  },
};
