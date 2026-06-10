import type { Db } from '../db';
import type { ItemRow } from '../db/types';
import { parseItemId, parseItemLink, wowheadUrl } from '../utils/wowItemParser';

export interface ItemInput {
  itemId?: string | null;
  itemLink?: string | null;
  itemName?: string | null;
}

export interface ResolvedItem {
  gameVersion: string;
  itemId: number | null;
  itemName: string;
  rawItemLink: string | null;
  wowheadUrl: string | null;
}

export type ItemResolution = { ok: true; item: ResolvedItem } | { ok: false; error: string };

/**
 * Resolves the /auction start item options into a normalized item record.
 * Requires at least one of item_id, item_link, item_name. Explicit item_name
 * wins over the name parsed from the link.
 */
export function resolveItem(input: ItemInput, gameVersion: string): ItemResolution {
  const itemLink = input.itemLink?.trim() || null;
  const itemIdInput = input.itemId?.trim() || null;
  const explicitName = input.itemName?.trim() || null;

  if (!itemLink && !itemIdInput && !explicitName) {
    return { ok: false, error: 'Provide at least one of item_id, item_link, or item_name.' };
  }

  let itemId: number | null = null;
  let parsedName: string | null = null;

  if (itemLink) {
    const parsed = parseItemLink(itemLink);
    if (!parsed) {
      return {
        ok: false,
        error:
          'Could not parse the item link. Expected a WoW link containing "Hitem:<id>", e.g. |cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r',
      };
    }
    itemId = parsed.itemId;
    parsedName = parsed.itemName ?? null;
  }

  if (itemIdInput) {
    const parsedId = parseItemId(itemIdInput);
    if (parsedId === null) {
      return { ok: false, error: `Could not parse an item id from "${itemIdInput}".` };
    }
    if (itemId !== null && itemId !== parsedId) {
      return {
        ok: false,
        error: `item_id (${parsedId}) does not match the id in item_link (${itemId}).`,
      };
    }
    itemId = parsedId;
  }

  const itemName = explicitName ?? parsedName ?? (itemId !== null ? `Item ${itemId}` : null);
  if (!itemName) {
    return { ok: false, error: 'Could not determine an item name.' };
  }

  return {
    ok: true,
    item: {
      gameVersion,
      itemId,
      itemName,
      rawItemLink: itemLink,
      wowheadUrl: itemId !== null ? wowheadUrl(itemId, gameVersion) : null,
    },
  };
}

export function insertItem(db: Db, item: ResolvedItem): ItemRow {
  const result = db
    .prepare(
      `INSERT INTO items (game_version, item_id, item_name, raw_item_link, wowhead_url)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(item.gameVersion, item.itemId, item.itemName, item.rawItemLink, item.wowheadUrl);
  return db.prepare('SELECT * FROM items WHERE id = ?').get(Number(result.lastInsertRowid)) as ItemRow;
}
