import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { handleButton, handleModal } from './discord/interactions';
import { AuctionScheduler, type AppContext } from './discord/lifecycle';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.sqlitePath);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const scheduler = new AuctionScheduler(() => ctx);
  const ctx: AppContext = { db, config, client, scheduler };

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    void scheduler.resumeActiveAuctions();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) {
          console.warn(`Unknown command: ${interaction.commandName}`);
          return;
        }
        await command.execute(interaction, ctx);
      } else if (interaction.isButton()) {
        await handleButton(interaction, ctx);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction, ctx);
      }
    } catch (error) {
      console.error('Error handling interaction:', error);
      if (interaction.isRepliable()) {
        const payload = {
          content: 'Something went wrong handling that. Please try again.',
          flags: MessageFlags.Ephemeral as const,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload).catch(() => undefined);
        } else {
          await interaction.reply(payload).catch(() => undefined);
        }
      }
    }
  });

  process.on('SIGINT', () => shutdown(ctx));
  process.on('SIGTERM', () => shutdown(ctx));

  await client.login(config.token);
}

function shutdown(ctx: AppContext): void {
  console.log('Shutting down…');
  void ctx.client.destroy().finally(() => {
    ctx.db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
