import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { formatGold } from '../discord/embeds';
import { getLedger, getUser } from '../services/auctions';
import { buildLedgerTextReport } from '../services/reports';
import type { BotCommand } from './types';

const LEDGER_DISPLAY_LIMIT = 20;
// Discord message content caps at 2000 characters; leave headroom for the
// code fence.
const INLINE_REPORT_LIMIT = 1900;

export const ledgerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ledger')
    .setDescription('Show won auctions and what is still owed')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to look up (defaults to you)')
    )
    .addStringOption((option) =>
      option
        .setName('format')
        .setDescription('embed (default), or text for a copyable report to share outside Discord')
        .addChoices({ name: 'embed', value: 'embed' }, { name: 'text', value: 'text' })
    ),
  async execute(interaction, ctx) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const ledger = getLedger(ctx.db, target.id);
    const registered = getUser(ctx.db, target.id);
    const displayName = target.displayName ?? target.username;

    if (interaction.options.getString('format') === 'text') {
      const report = buildLedgerTextReport({ displayName, character: registered, ledger });
      const block = '```text\n' + report + '\n```';
      if (block.length <= INLINE_REPORT_LIMIT) {
        await interaction.reply({ content: block, allowedMentions: { parse: [] } });
      } else {
        await interaction.reply({
          content: `Ledger for **${displayName}** attached as a text file (too long to show inline).`,
          files: [
            new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: `ledger-${target.id}.txt` }),
          ],
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(ledger.totalOwed > 0 ? 0xe74c3c : 0x2ecc71)
      .setTitle(`Loot ledger — ${displayName}`)
      .setFooter({ text: 'Settlement is in-game gold/trade only.' });

    if (registered) {
      embed.setDescription(`Character: **${registered.character_name}** — ${registered.realm}`);
    }

    if (ledger.entries.length === 0) {
      embed.addFields({ name: 'Won auctions', value: 'None yet.' });
    } else {
      // Discord embed field values cap at 1024 characters.
      const lines: string[] = [];
      let omitted = 0;
      let used = 0;
      for (const [index, entry] of ledger.entries.entries()) {
        const line = `#${entry.auction_id} — **${entry.item_name}** — ${formatGold(entry.final_price)} — *${entry.settlement_status}*`;
        if (index >= LEDGER_DISPLAY_LIMIT || used + line.length + 1 > 950) {
          omitted = ledger.entries.length - index;
          break;
        }
        lines.push(line);
        used += line.length + 1;
      }
      if (omitted > 0) lines.push(`…and ${omitted} more.`);
      embed.addFields(
        { name: `Won auctions (${ledger.entries.length})`, value: lines.join('\n') },
        { name: 'Total owed (unpaid)', value: formatGold(ledger.totalOwed), inline: true },
        { name: 'Settled (paid/traded)', value: formatGold(ledger.totalSettled), inline: true }
      );
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
