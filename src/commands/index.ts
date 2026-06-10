import { auctionCommand } from './auction';
import { bidCommand } from './bid';
import { ledgerCommand } from './ledger';
import { payoutCommand } from './payout';
import { registerCommand } from './register';
import { settleCommand } from './settle';
import type { BotCommand } from './types';

export const commandList: BotCommand[] = [
  registerCommand,
  auctionCommand,
  bidCommand,
  settleCommand,
  ledgerCommand,
  payoutCommand,
];

export const commands = new Map<string, BotCommand>(
  commandList.map((command) => [command.data.name, command])
);
