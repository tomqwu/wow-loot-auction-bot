import { REST, Routes } from 'discord.js';
import { commandList } from './commands';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const body = commandList.map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.token);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Registered ${body.length} slash commands in guild ${config.guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(
      `Registered ${body.length} global slash commands (may take up to an hour to appear).`
    );
  }
}

main().catch((error) => {
  console.error('Failed to register slash commands:', error);
  process.exit(1);
});
