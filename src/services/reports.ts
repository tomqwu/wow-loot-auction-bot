import type { UserRow } from '../db/types';
import {
  DEFAULT_CURRENCY_UNIT,
  formatAmount,
  unitLabel,
  type CurrencyUnit,
} from '../utils/format';
import type { LedgerSummary } from './auctions';

export interface LedgerReportInput {
  /** Discord display name of the ledger's owner. */
  displayName: string;
  character?: Pick<UserRow, 'character_name' | 'realm'>;
  ledger: LedgerSummary;
  unit?: CurrencyUnit;
  nowMs?: number;
}

function formatUtcDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 10);
}

/**
 * Renders a ledger as plain text with no Discord-specific markup (mentions,
 * bold, embeds), so it can be copied and shared anywhere — guild forums,
 * WeChat, QQ, spreadsheets. One pipe-separated line per won auction.
 */
export function buildLedgerTextReport(input: LedgerReportInput): string {
  const { displayName, character, ledger } = input;
  const unit = input.unit ?? DEFAULT_CURRENCY_UNIT;
  const fmt = (amount: number): string => formatAmount(amount, unit);
  const generatedAt = new Date(input.nowMs ?? Date.now())
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
  const owner = character
    ? `${displayName} (${character.character_name} - ${character.realm})`
    : displayName;

  const lines: string[] = [`Loot ledger — ${owner}`, `Generated ${generatedAt} UTC`, ''];

  if (ledger.entries.length === 0) {
    lines.push('No won auctions yet.');
  } else {
    for (const entry of ledger.entries) {
      lines.push(
        `#${entry.auction_id} | ${entry.item_name} | ${fmt(entry.final_price)} | ` +
          `${entry.settlement_status} | ${formatUtcDate(entry.closed_at)}`
      );
    }
    lines.push(
      '',
      `Won auctions: ${ledger.entries.length}`,
      `Total owed (unpaid): ${fmt(ledger.totalOwed)}`,
      `Settled (paid/traded): ${fmt(ledger.totalSettled)}`
    );
  }

  lines.push('', `Settlement is ${unitLabel(unit)}/trade only — no real-money payments.`);
  return lines.join('\n');
}
