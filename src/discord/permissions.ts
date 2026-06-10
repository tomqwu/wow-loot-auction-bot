import {
  GuildMember,
  PermissionFlagsBits,
  type APIInteractionGuildMember,
  type Interaction,
} from 'discord.js';
import type { Db } from '../db';
import { getUser } from '../services/auctions';

/**
 * Officers are members holding one of the configured role names
 * (case-insensitive), or guild administrators.
 */
export function isOfficer(
  member: GuildMember | APIInteractionGuildMember | null,
  officerRoles: string[]
): boolean {
  if (!member || !(member instanceof GuildMember)) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const wanted = new Set(officerRoles.map((r) => r.toLowerCase()));
  return member.roles.cache.some((role) => wanted.has(role.name.toLowerCase()));
}

export function requireOfficer(
  interaction: Interaction,
  officerRoles: string[]
): { ok: true } | { ok: false; message: string } {
  if (!interaction.inGuild()) {
    return { ok: false, message: 'This command can only be used inside a server.' };
  }
  if (!isOfficer(interaction.member, officerRoles)) {
    return {
      ok: false,
      message: `Only officers can do this (roles: ${officerRoles.join(', ')} or server admins).`,
    };
  }
  return { ok: true };
}

export function requireRegistered(
  db: Db,
  discordUserId: string
): { ok: true } | { ok: false; message: string } {
  if (!getUser(db, discordUserId)) {
    return {
      ok: false,
      message:
        'You need to register a character before bidding: `/register character:<name> realm:<realm>`',
    };
  }
  return { ok: true };
}
