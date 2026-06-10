import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  getAuction,
  getHighestBid,
  minimumAcceptableBid,
} from '../services/auctions';
import { executeBidFlow, executeCloseFlow, type AppContext } from './lifecycle';
import { requireOfficer, requireRegistered } from './permissions';

const QUICK_BID_DELTAS: Record<string, number> = { '500': 500, '1000': 1000 };

export async function handleButton(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const [scope, action, idRaw] = interaction.customId.split(':');
  const auctionId = Number(idRaw);
  if (!Number.isSafeInteger(auctionId)) return;

  if (scope === 'auction' && action === 'close') {
    const permission = requireOfficer(interaction, ctx.config.officerRoles);
    if (!permission.ok) {
      await interaction.reply({ content: permission.message, flags: MessageFlags.Ephemeral });
      return;
    }
    const result = await executeCloseFlow(ctx, {
      auctionId,
      actorUserId: interaction.user.id,
      cancel: false,
    });
    await interaction.reply(
      result.ok
        ? { content: result.message }
        : { content: result.message, flags: MessageFlags.Ephemeral }
    );
    return;
  }

  if (scope !== 'bid' || !action) return;

  if (action === 'custom') {
    const modal = new ModalBuilder()
      .setCustomId(`bidmodal:${auctionId}`)
      .setTitle(`Custom bid — auction #${auctionId}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('amount')
            .setLabel('Bid amount in gold (whole number)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  const registration = requireRegistered(ctx.db, interaction.user.id);
  if (!registration.ok) {
    await interaction.reply({ content: registration.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const auction = getAuction(ctx.db, auctionId);
  if (!auction) {
    await interaction.reply({
      content: `Auction #${auctionId} not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const highestBid = getHighestBid(ctx.db, auctionId) ?? null;
  const nextMinimum = minimumAcceptableBid(auction, highestBid !== null);

  let amount: number;
  if (action === 'min') {
    amount = nextMinimum;
  } else {
    const delta = QUICK_BID_DELTAS[action];
    if (delta === undefined) return;
    const base = highestBid ? auction.current_price : auction.start_price;
    amount = Math.max(nextMinimum, base + delta);
  }

  const result = await executeBidFlow(ctx, {
    auctionId,
    userId: interaction.user.id,
    amount,
    allowSelfRaise: false,
  });
  await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
}

export async function handleModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext
): Promise<void> {
  const [scope, idRaw] = interaction.customId.split(':');
  if (scope !== 'bidmodal') return;
  const auctionId = Number(idRaw);
  if (!Number.isSafeInteger(auctionId)) return;

  const registration = requireRegistered(ctx.db, interaction.user.id);
  if (!registration.ok) {
    await interaction.reply({ content: registration.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const raw = interaction.fields.getTextInputValue('amount').trim().replace(/[,\s]/g, '');
  const amount = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await interaction.reply({
      content: `"${raw || interaction.fields.getTextInputValue('amount')}" is not a valid bid. Enter a positive whole number of gold.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await executeBidFlow(ctx, {
    auctionId,
    userId: interaction.user.id,
    amount,
    allowSelfRaise: true,
  });
  await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
}
