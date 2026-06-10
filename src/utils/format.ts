/**
 * Bid/ledger denominations. In-game units only — real-money currencies are
 * intentionally not representable here.
 */
export const CURRENCY_UNITS = {
  points: { suffix: ' pts', label: 'guild points' },
  dkp: { suffix: ' DKP', label: 'DKP points' },
  gold: { suffix: 'g', label: 'in-game gold' },
} as const;

export type CurrencyUnit = keyof typeof CURRENCY_UNITS;

/** Bot-wide default bid denomination; override with the CURRENCY_UNIT env var. */
export const DEFAULT_CURRENCY_UNIT: CurrencyUnit = 'points';

export function formatAmount(amount: number, unit: CurrencyUnit): string {
  return `${amount.toLocaleString('en-US')}${CURRENCY_UNITS[unit].suffix}`;
}

export function unitLabel(unit: CurrencyUnit): string {
  return CURRENCY_UNITS[unit].label;
}

export function formatGold(amount: number): string {
  return formatAmount(amount, 'gold');
}
