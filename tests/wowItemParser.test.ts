import { describe, expect, it } from 'vitest';
import { parseItemId, parseItemLink, wowheadUrl } from '../src/utils/wowItemParser';

const ASHKANDI_LINK =
  '|cffa335ee|Hitem:19364::::::::|h[Ashkandi, Greatsword of the Brotherhood]|h|r';

describe('parseItemLink', () => {
  it('parses id and name from a full raw item link', () => {
    expect(parseItemLink(ASHKANDI_LINK)).toEqual({
      itemId: 19364,
      itemName: 'Ashkandi, Greatsword of the Brotherhood',
    });
  });

  it('parses links with populated payload fields', () => {
    const link = '|cffff8000|Hitem:19019:0:0:0:0:0:0:0:60|h[Thunderfury, Blessed Blade of the Windseeker]|h|r';
    expect(parseItemLink(link)).toEqual({
      itemId: 19019,
      itemName: 'Thunderfury, Blessed Blade of the Windseeker',
    });
  });

  it('parses a bare Hitem fragment without a name', () => {
    expect(parseItemLink('Hitem:19364')).toEqual({ itemId: 19364, itemName: undefined });
  });

  it('parses an item: fragment', () => {
    expect(parseItemLink('item:19364::::::::')).toEqual({ itemId: 19364, itemName: undefined });
  });

  it('returns null for strings without an item id', () => {
    expect(parseItemLink('Ashkandi, Greatsword of the Brotherhood')).toBeNull();
    expect(parseItemLink('')).toBeNull();
    expect(parseItemLink('Hitem:abc')).toBeNull();
  });

  it('rejects non-positive ids', () => {
    expect(parseItemLink('Hitem:0')).toBeNull();
  });
});

describe('parseItemId', () => {
  it('parses a bare numeric id', () => {
    expect(parseItemId('19364')).toBe(19364);
    expect(parseItemId('  19364  ')).toBe(19364);
  });

  it('parses item:<id> and item=<id> forms', () => {
    expect(parseItemId('item:19364')).toBe(19364);
    expect(parseItemId('item=19364')).toBe(19364);
  });

  it('parses a full item link', () => {
    expect(parseItemId(ASHKANDI_LINK)).toBe(19364);
  });

  it('returns null for invalid input', () => {
    expect(parseItemId('not an item')).toBeNull();
    expect(parseItemId('')).toBeNull();
    expect(parseItemId('-5')).toBeNull();
    expect(parseItemId('0')).toBeNull();
  });
});

describe('wowheadUrl', () => {
  it('defaults to classic', () => {
    expect(wowheadUrl(19364)).toBe('https://www.wowhead.com/classic/item=19364');
  });

  it('supports retail', () => {
    expect(wowheadUrl(19364, 'retail')).toBe('https://www.wowhead.com/item=19364');
  });

  it('supports wrath classic', () => {
    expect(wowheadUrl(19364, 'wotlk')).toBe('https://www.wowhead.com/wotlk/item=19364');
  });

  it('falls back to classic for unknown versions', () => {
    expect(wowheadUrl(19364, 'pandaria-plus')).toBe('https://www.wowhead.com/classic/item=19364');
  });
});
