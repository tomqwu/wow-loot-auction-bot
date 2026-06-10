import { describe, expect, it } from 'vitest';
import { buildPayoutReport, parsePayoutEntries } from '../src/services/payoutReport';

const NOW = 1_750_000_000_000; // 2025-06-15 15:06 UTC

const SAMPLE = [
  '# weekly settlement',
  'Zhw | SSC+TK | 283.83 | 83.48 | melee #1',
  'Acess | SSC+TK | 283.83 | 83.48 | ranged #1 | collected by Nautile',
  'Acess | Gruul | 8.80',
  '包子 | SSC+TK | 0 | 41.74 | melee #2 (Skyese)',
  '',
  'total = 785.16',
  'title = Week 23',
].join('\n');

describe('parsePayoutEntries', () => {
  it('parses payout lines, directives, and skips comments/blanks', () => {
    const result = parsePayoutEntries(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.lines).toHaveLength(4);
    expect(result.input.expectedTotal).toBe(785.16);
    expect(result.input.title).toBe('Week 23');
    expect(result.input.lines[0]).toEqual({
      player: 'Zhw',
      source: 'SSC+TK',
      base: 283.83,
      subsidy: 83.48,
      reason: 'melee #1',
      note: null,
    });
    expect(result.input.lines[2]).toEqual({
      player: 'Acess',
      source: 'Gruul',
      base: 8.8,
      subsidy: 0,
      reason: null,
      note: null,
    });
  });

  it('accepts thousands separators and colon directives', () => {
    const result = parsePayoutEntries('Acess | SSC+TK | 1,283.83\ntotal: 1,283.83');
    expect(result).toMatchObject({
      ok: true,
      input: { expectedTotal: 1283.83, lines: [{ base: 1283.83 }] },
    });
  });

  it('reports malformed lines with their line numbers', () => {
    const result = parsePayoutEntries(
      ['Acess | SSC+TK | abc', 'OnlyAName', 'Bob | Gruul | 10 | xyz', 'total = lots'].join('\n')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(4);
    expect(result.errors[0]).toContain('Line 1');
    expect(result.errors[0]).toContain('abc');
    expect(result.errors[1]).toContain('Line 2');
    expect(result.errors[2]).toContain('"xyz" is not a valid subsidy');
    expect(result.errors[3]).toContain('not a valid total');
  });

  it('rejects input with no payout lines', () => {
    const result = parsePayoutEntries('# just a comment\n\ntitle = empty week');
    expect(result).toMatchObject({ ok: false, errors: [expect.stringContaining('No payout lines')] });
  });
});

function build(text: string, nowMs = NOW): string {
  const parsed = parsePayoutEntries(text);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return buildPayoutReport(parsed.input, nowMs);
}

describe('buildPayoutReport', () => {
  it('renders per-player blocks with per-raid subtotals kept separate', () => {
    const report = build(SAMPLE);
    expect(report).toContain('Payout report — Week 23');
    expect(report).toContain('Generated 2025-06-15 15:06 UTC');
    // Per-raid lines stay separate so proxy-played raids are visible.
    expect(report).toContain('Acess：376.11g');
    expect(report).toContain('  SSC+TK：367.31g（base 283.83g + subsidy 83.48g — ranged #1）');
    expect(report).toContain('  Gruul：8.80g（base 8.80g）');
    expect(report).toContain('  Base total：292.63g');
    expect(report).toContain('  Subsidy total：83.48g');
    expect(report).toContain('  Note：collected by Nautile');
    expect(report).toContain('包子：41.74g');
    expect(report).toContain('Players：3');
  });

  it('sorts players deterministically and alphabetically for Latin names', () => {
    const report = build(SAMPLE);
    const acess = report.indexOf('Acess：');
    const baozi = report.indexOf('包子：');
    const zhw = report.indexOf('Zhw：');
    // All players present, Latin names in alphabetical order. The relative
    // placement of CJK names depends on the ICU collation data, so it is not
    // asserted — only that the sort is deterministic.
    expect(acess).toBeGreaterThan(-1);
    expect(baozi).toBeGreaterThan(-1);
    expect(acess).toBeLessThan(zhw);
    expect(report).toBe(build(SAMPLE));
  });

  it('shows a passing check when totals match the expected total', () => {
    const report = build(SAMPLE);
    expect(report).toContain('Grand total：785.16g');
    expect(report).toContain('Check：785.16g paid = 785.16g expected ✅');
  });

  it('shows a failing check with the difference when totals mismatch', () => {
    const report = build('Acess | SSC+TK | 100\ntotal = 110');
    expect(report).toContain('Check：100.00g paid ≠ 110.00g expected ❌（difference 10.00g）');
  });

  it('omits the title and reports the sum when no directives are given', () => {
    const report = build('Acess | SSC+TK | 100');
    expect(report.split('\n')[0]).toBe('Payout report');
    expect(report).toContain('Check：grand total 100.00g（no expected total given）');
  });

  it('deduplicates identical notes across raids', () => {
    const report = build(
      'Nekopunchee | SSC+TK | 100 | | | collected by Nautile\nNekopunchee | Gruul | 10 | | | collected by Nautile'
    );
    expect(report.match(/Note：collected by Nautile/g)).toHaveLength(1);
  });

  it('always states the in-game gold policy', () => {
    expect(build('Acess | SSC+TK | 100')).toContain(
      'Amounts are in-game gold only — no real-money payments.'
    );
  });

  it('defaults the generated timestamp to now', () => {
    const parsed = parsePayoutEntries('Acess | SSC+TK | 100');
    if (!parsed.ok) throw new Error('unexpected');
    expect(buildPayoutReport(parsed.input)).toMatch(/Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });
});
