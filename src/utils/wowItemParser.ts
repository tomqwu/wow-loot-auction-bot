export interface ParsedItemLink {
  itemId: number;
  itemName?: string;
}

/**
 * Parses a raw WoW item link such as:
 *   |cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r
 * Also accepts partial forms like "Hitem:19364" or "item:19364:0:0:0".
 */
export function parseItemLink(raw: string): ParsedItemLink | null {
  if (!raw) return null;
  const idMatch = raw.match(/\bH?item:(\d+)/i);
  if (!idMatch || !idMatch[1]) return null;
  const itemId = Number(idMatch[1]);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return null;
  const nameMatch = raw.match(/\|h\[([^\]]+)\]/);
  const itemName = nameMatch?.[1]?.trim();
  return { itemId, itemName: itemName || undefined };
}

/**
 * Parses an item id from user input: a bare number ("19364"), an
 * "item:19364" / "item=19364" form, or a full item link.
 */
export function parseItemId(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const bare = trimmed.match(/^(\d+)$/) ?? trimmed.match(/^item[:=](\d+)$/i);
  if (bare && bare[1]) {
    const id = Number(bare[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return parseItemLink(trimmed)?.itemId ?? null;
}

const WOWHEAD_PREFIXES: Record<string, string> = {
  classic: 'classic/',
  era: 'classic/',
  sod: 'classic/',
  hardcore: 'classic/',
  tbc: 'tbc/',
  wotlk: 'wotlk/',
  wrath: 'wotlk/',
  cata: 'cata/',
  mop: 'mop-classic/',
  retail: '',
};

/** Builds a Wowhead item URL. Unknown game versions fall back to classic. */
export function wowheadUrl(itemId: number, gameVersion = 'classic'): string {
  const prefix = WOWHEAD_PREFIXES[gameVersion.toLowerCase()] ?? 'classic/';
  return `https://www.wowhead.com/${prefix}item=${itemId}`;
}
