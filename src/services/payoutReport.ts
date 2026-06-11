/**
 * Formats officer-entered raid payout numbers into a shareable plain-text
 * report. This module does NOT compute splits — officers enter the final
 * per-player amounts and the report only sums them per player, totals them,
 * and renders a validation check line. All amounts are in-game gold.
 *
 * Input format (one line per player per raid/income source):
 *
 *   player | raid | base | subsidy | reason | note
 *
 * subsidy/reason/note are optional. Blank lines and lines starting with #
 * are ignored. Three directives are supported:
 *
 *   total = 8568        expected grand total for the validation line
 *   title = Week 23     report title
 *   unit = gold         in-game denomination: gold (default), dkp, points
 *
 * Only in-game units are supported. Real-money currencies (RMB, USD, …) are
 * deliberately rejected — the bot does not do real-money payment tracking.
 */

import { CURRENCY_UNITS, DEFAULT_CURRENCY_UNIT, type CurrencyUnit } from '../utils/format';

export interface PayoutLine {
  player: string;
  source: string;
  base: number;
  subsidy: number;
  reason: string | null;
  note: string | null;
}

export const PAYOUT_UNITS = CURRENCY_UNITS;

export type PayoutUnit = CurrencyUnit;

export interface PayoutInput {
  lines: PayoutLine[];
  expectedTotal: number | null;
  title: string | null;
  unit: PayoutUnit;
}

export type PayoutParseResult =
  | { ok: true; input: PayoutInput }
  | { ok: false; errors: string[] };

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parsePayoutEntries(
  raw: string,
  defaultUnit: PayoutUnit = DEFAULT_CURRENCY_UNIT
): PayoutParseResult {
  const lines: PayoutLine[] = [];
  const errors: string[] = [];
  let expectedTotal: number | null = null;
  let title: string | null = null;
  let unit: PayoutUnit = defaultUnit;

  raw.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line || line.startsWith('#')) return;

    const directive = line.match(/^(total|title|unit|currency)\s*[:=]\s*(.+)$/i);
    if (directive) {
      const keyword = directive[1]!.toLowerCase();
      const value = directive[2]!.trim();
      if (keyword === 'total') {
        const amount = parseAmount(value);
        if (amount === null) errors.push(`Line ${lineNo}: "${value}" is not a valid total.`);
        else expectedTotal = amount;
      } else if (keyword === 'title') {
        title = value;
      } else {
        const requested = value.toLowerCase();
        if (requested in PAYOUT_UNITS) {
          unit = requested as PayoutUnit;
        } else {
          errors.push(
            `Line ${lineNo}: unit "${value}" is not supported. Use an in-game unit: ` +
              `${Object.keys(PAYOUT_UNITS).join(', ')}. Real-money currencies are not supported.`
          );
        }
      }
      return;
    }

    const [player, source, baseRaw, subsidyRaw, reason, note] = line
      .split('|')
      .map((field) => field.trim());
    if (!player || !source || !baseRaw) {
      errors.push(
        `Line ${lineNo}: expected "player | raid | base [| subsidy | reason | note]", got "${line}".`
      );
      return;
    }
    const base = parseAmount(baseRaw);
    if (base === null) {
      errors.push(`Line ${lineNo}: "${baseRaw}" is not a valid base amount.`);
      return;
    }
    let subsidy = 0;
    if (subsidyRaw) {
      const parsed = parseAmount(subsidyRaw);
      if (parsed === null) {
        errors.push(`Line ${lineNo}: "${subsidyRaw}" is not a valid subsidy amount.`);
        return;
      }
      subsidy = parsed;
    }
    lines.push({ player, source, base, subsidy, reason: reason || null, note: note || null });
  });

  if (lines.length === 0 && errors.length === 0) {
    errors.push('No payout lines found. Add one "player | raid | base" line per player per raid.');
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, input: { lines, expectedTotal, title, unit } };
}

function makeFmt(unit: PayoutUnit): (amount: number) => string {
  const { suffix } = PAYOUT_UNITS[unit];
  return (amount) =>
    `${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}${suffix}`;
}

/**
 * Renders the payout report: players sorted alphabetically with zh
 * locale-aware collation (CJK names sort deterministically alongside Latin
 * ones), one block per player with per-raid subtotals kept separate, then
 * grand totals and a paid-vs-expected check.
 */
export function buildPayoutReport(input: PayoutInput, nowMs?: number): string {
  const fmt = makeFmt(input.unit);
  const generatedAt = new Date(nowMs ?? Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  const byPlayer = new Map<string, PayoutLine[]>();
  for (const line of input.lines) {
    const entries = byPlayer.get(line.player) ?? [];
    entries.push(line);
    byPlayer.set(line.player, entries);
  }
  const players = [...byPlayer.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const out: string[] = [
    `Payout report${input.title ? ` — ${input.title}` : ''}`,
    `Generated ${generatedAt} UTC`,
    '',
  ];

  let grandBase = 0;
  let grandSubsidy = 0;
  for (const player of players) {
    const entries = byPlayer.get(player)!;
    const base = entries.reduce((sum, entry) => sum + entry.base, 0);
    const subsidy = entries.reduce((sum, entry) => sum + entry.subsidy, 0);
    grandBase += base;
    grandSubsidy += subsidy;

    out.push(`${player}：${fmt(base + subsidy)}`);
    for (const entry of entries) {
      const detail =
        entry.subsidy > 0
          ? `base ${fmt(entry.base)} + subsidy ${fmt(entry.subsidy)}${entry.reason ? ` — ${entry.reason}` : ''}`
          : `base ${fmt(entry.base)}`;
      out.push(`  ${entry.source}：${fmt(entry.base + entry.subsidy)}（${detail}）`);
    }
    out.push(`  Base total：${fmt(base)}`, `  Subsidy total：${fmt(subsidy)}`);
    const notes = new Set(entries.map((entry) => entry.note).filter((n): n is string => n !== null));
    for (const note of notes) out.push(`  Note：${note}`);
    out.push('');
  }

  const grand = grandBase + grandSubsidy;
  out.push(
    `Players：${players.length}`,
    `Base total：${fmt(grandBase)}`,
    `Subsidy total：${fmt(grandSubsidy)}`,
    `Grand total：${fmt(grand)}`
  );
  if (input.expectedTotal !== null) {
    const matches = Math.abs(grand - input.expectedTotal) < 0.005;
    out.push(
      matches
        ? `Check：${fmt(grand)} paid = ${fmt(input.expectedTotal)} expected ✅`
        : `Check：${fmt(grand)} paid ≠ ${fmt(input.expectedTotal)} expected ❌（difference ${fmt(Math.abs(grand - input.expectedTotal))}）`
    );
  } else {
    out.push(`Check：grand total ${fmt(grand)}（no expected total given）`);
  }
  out.push('', `Amounts are ${PAYOUT_UNITS[input.unit].label} only — no real-money payments.`);
  return out.join('\n');
}
