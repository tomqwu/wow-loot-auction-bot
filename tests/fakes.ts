import {
  Collection,
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import { vi } from 'vitest';
import type { BotConfig } from '../src/config';
import { openDatabase } from '../src/db';
import type { AuctionRow } from '../src/db/types';
import { AuctionScheduler, type AppContext } from '../src/discord/lifecycle';
import { createAuction, setAuctionMessage } from '../src/services/auctions';
import { insertItem, resolveItem } from '../src/services/items';

export const ASHKANDI_LINK =
  '|cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r';

export const TEST_CONFIG: BotConfig = {
  token: 'test-token',
  clientId: 'test-client',
  guildId: 'test-guild',
  sqlitePath: ':memory:',
  officerRoles: ['Raid Leader', 'Auctioneer'],
  gameVersion: 'classic',
  currencyUnit: 'gold',
};

export interface FakeMessage {
  id: string;
  channelId: string;
  edit: ReturnType<typeof vi.fn>;
}

export interface FakeChannel {
  isTextBased: () => boolean;
  messages: { fetch: ReturnType<typeof vi.fn> };
  send: ReturnType<typeof vi.fn>;
}

export function makeFakeMessage(id = 'msg-1', channelId = 'chan-1'): FakeMessage {
  return { id, channelId, edit: vi.fn(async () => undefined) };
}

export function makeFakeChannel(message: FakeMessage): FakeChannel {
  return {
    isTextBased: () => true,
    messages: { fetch: vi.fn(async () => message) },
    send: vi.fn(async () => undefined),
  };
}

export function makeFakeClient(channel: unknown): Client {
  return { channels: { fetch: vi.fn(async () => channel) } } as unknown as Client;
}

export interface TestContext extends AppContext {
  message: FakeMessage;
  channel: FakeChannel;
}

/** App context backed by an in-memory database and a faked Discord client. */
export function makeContext(overrides: { client?: Client; channel?: unknown } = {}): TestContext {
  const db = openDatabase(':memory:');
  const message = makeFakeMessage();
  const channel = makeFakeChannel(message);
  const client =
    overrides.client ?? makeFakeClient('channel' in overrides ? overrides.channel : channel);
  const partial = { db, config: TEST_CONFIG, client } as TestContext;
  partial.scheduler = new AuctionScheduler(() => partial);
  partial.message = message;
  partial.channel = channel;
  return partial;
}

export interface SeedAuctionOptions {
  startPrice?: number;
  minIncrement?: number;
  durationMinutes?: number;
  nowMs?: number;
  /** Link the auction to the fake message so embed refreshes have a target. */
  withMessage?: boolean;
}

export function seedAuction(ctx: TestContext, options: SeedAuctionOptions = {}): AuctionRow {
  const resolution = resolveItem({ itemLink: ASHKANDI_LINK }, ctx.config.gameVersion);
  if (!resolution.ok) throw new Error(resolution.error);
  const item = insertItem(ctx.db, resolution.item);
  const auction = createAuction(ctx.db, {
    itemRefId: item.id,
    channelId: ctx.message.channelId,
    startPrice: options.startPrice ?? 1000,
    minIncrement: options.minIncrement ?? 100,
    durationMinutes: options.durationMinutes ?? 60,
    createdBy: 'leader',
    nowMs: options.nowMs,
  });
  if (options.withMessage ?? true) {
    setAuctionMessage(ctx.db, auction.id, ctx.message.channelId, ctx.message.id);
    return { ...auction, channel_id: ctx.message.channelId, message_id: ctx.message.id };
  }
  return auction;
}

/**
 * isOfficer requires a real GuildMember instance, so fakes are built on the
 * GuildMember prototype with own-property permissions/roles shadowing the
 * library getters.
 */
export function makeMember(roleNames: string[] = [], admin = false): GuildMember {
  const member = Object.create(GuildMember.prototype) as GuildMember;
  Object.defineProperty(member, 'permissions', {
    value: new PermissionsBitField(admin ? PermissionFlagsBits.Administrator : 0n),
  });
  Object.defineProperty(member, 'roles', {
    value: {
      cache: new Collection(roleNames.map((name, index) => [String(index), { name }])),
    },
  });
  return member;
}

export interface FakeReplyPayload {
  content?: string;
  flags?: number;
  embeds?: unknown[];
  components?: unknown[];
  files?: unknown[];
}

export interface FakeUser {
  id: string;
  username?: string;
  displayName?: string;
}

export interface ChatInteractionOptions {
  member?: GuildMember | null;
  user?: FakeUser;
  channelId?: string | null;
  inGuild?: boolean;
  subcommand?: string;
  integers?: Record<string, number>;
  strings?: Record<string, string>;
  users?: Record<string, FakeUser>;
}

export interface FakeChatInteraction {
  user: FakeUser;
  member: GuildMember | null;
  channelId: string | null;
  inGuild: () => boolean;
  options: {
    getSubcommand: () => string;
    getInteger: (name: string) => number | null;
    getString: (name: string) => string | null;
    getUser: (name: string) => FakeUser | null;
  };
  reply: ReturnType<typeof vi.fn>;
  fetchReply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
  replies: FakeReplyPayload[];
}

export function makeChatInteraction(options: ChatInteractionOptions = {}): FakeChatInteraction {
  const replies: FakeReplyPayload[] = [];
  const channelId = options.channelId === undefined ? 'chan-1' : options.channelId;
  return {
    user: options.user ?? { id: 'user-1', username: 'tester', displayName: 'Tester' },
    member: options.member ?? null,
    channelId,
    inGuild: () => options.inGuild ?? true,
    options: {
      getSubcommand: () => options.subcommand ?? '',
      getInteger: (name) => options.integers?.[name] ?? null,
      getString: (name) => options.strings?.[name] ?? null,
      getUser: (name) => options.users?.[name] ?? null,
    },
    reply: vi.fn(async (payload: FakeReplyPayload | string) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    }),
    fetchReply: vi.fn(async () => ({ id: 'msg-1', channelId: channelId ?? 'chan-1' })),
    showModal: vi.fn(async () => undefined),
    replies,
  };
}

export function asChatInput(interaction: FakeChatInteraction): ChatInputCommandInteraction {
  return interaction as unknown as ChatInputCommandInteraction;
}

export interface FakeButtonInteraction {
  customId: string;
  user: FakeUser;
  member: GuildMember | null;
  inGuild: () => boolean;
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
  replies: FakeReplyPayload[];
}

export function makeButtonInteraction(
  customId: string,
  options: { member?: GuildMember | null; user?: FakeUser } = {}
): FakeButtonInteraction {
  const replies: FakeReplyPayload[] = [];
  return {
    customId,
    user: options.user ?? { id: 'user-1', username: 'tester' },
    member: options.member ?? null,
    inGuild: () => true,
    reply: vi.fn(async (payload: FakeReplyPayload | string) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    }),
    showModal: vi.fn(async () => undefined),
    replies,
  };
}

export interface FakeModalInteraction {
  customId: string;
  user: FakeUser;
  fields: { getTextInputValue: (id: string) => string };
  reply: ReturnType<typeof vi.fn>;
  replies: FakeReplyPayload[];
}

export function makeModalInteraction(
  customId: string,
  amountValue: string,
  options: { user?: FakeUser } = {}
): FakeModalInteraction {
  const replies: FakeReplyPayload[] = [];
  return {
    customId,
    user: options.user ?? { id: 'user-1', username: 'tester' },
    fields: { getTextInputValue: () => amountValue },
    reply: vi.fn(async (payload: FakeReplyPayload | string) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    }),
    replies,
  };
}
