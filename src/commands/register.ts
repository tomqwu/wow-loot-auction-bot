import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { upsertUser } from '../services/auctions';
import type { BotCommand } from './types';

export const registerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your WoW character so you can bid in loot auctions')
    .addStringOption((option) =>
      option
        .setName('character')
        .setDescription('Your WoW character name')
        .setRequired(true)
        .setMaxLength(48)
    )
    .addStringOption((option) =>
      option.setName('realm').setDescription('Your realm').setRequired(true).setMaxLength(48)
    ),
  async execute(interaction, ctx) {
    const character = interaction.options.getString('character', true).trim();
    const realm = interaction.options.getString('realm', true).trim();
    if (!character || !realm) {
      await interaction.reply({
        content: 'Character and realm cannot be empty.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const user = upsertUser(ctx.db, interaction.user.id, character, realm);
    await interaction.reply({
      content: `Registered **${user.character_name}** on **${user.realm}**. You can now bid in auctions.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
