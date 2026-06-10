import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { PAYOUT_MODAL_ID } from '../commands/payout';
import {
  getAuction,
  getHighestBid,
  minimumAcceptableBid,
} from '../services/auctions';
import { buildPayoutReport, parsePayoutEntries } from '../services/payoutReport';
import { executeBidFlow, executeCloseFlow, type AppContext } from './lifecycle';
import { requireOfficer, requireRegistered } from './permissions';
import { textReportPayload } from './textReport';

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
            .setLabel('Bid amount (whole number)')
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

async function handlePayoutModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext
): Promise<void> {
  const parsed = parsePayoutEntries(
    interaction.fields.getTextInputValue('entries'),
    ctx.config.currencyUnit
  );
  if (!parsed.ok) {
    const shown = parsed.errors.slice(0, 10);
    const omitted = parsed.errors.length - shown.length;
    await interaction.reply({
      content:
        `Could not parse the payout entries:\n${shown.map((error) => `• ${error}`).join('\n')}` +
        (omitted > 0 ? `\n…and ${omitted} more.` : ''),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const report = buildPayoutReport(parsed.input);
  await interaction.reply(
    textReportPayload(
      report,
      'payout-report.txt',
      'Payout report attached as a text file (too long to show inline).'
    )
  );
}

export async function handleModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext
): Promise<void> {
  const [scope, idRaw] = interaction.customId.split(':');
  if (scope === PAYOUT_MODAL_ID) {
    await handlePayoutModal(interaction, ctx);
    return;
  }
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
      content: `"${raw || interaction.fields.getTextInputValue('amount')}" is not a valid bid. Enter a positive whole number.`,
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
