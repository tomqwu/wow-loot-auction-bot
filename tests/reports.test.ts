import { describe, expect, it } from 'vitest';
import { buildLedgerTextReport } from '../src/services/reports';
import type { LedgerSummary } from '../src/services/auctions';

const NOW = 1_750_000_000_000; // 2025-06-15 15:06 UTC

const SAMPLE_LEDGER: LedgerSummary = {
  entries: [
    {
      auction_id: 12,
      item_name: 'Ashkandi, Greatsword of the Brotherhood',
      final_price: 1500,
      closed_at: NOW,
      settlement_status: 'unpaid',
    },
    {
      auction_id: 10,
      item_name: 'Netherwind Crown',
      final_price: 800,
      closed_at: NOW - 86_400_000,
      settlement_status: 'paid',
    },
  ],
  totalOwed: 1500,
  totalSettled: 800,
};

describe('buildLedgerTextReport', () => {
  it('renders entries, totals, and dates as plain text', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      character: { character_name: 'Bobbo', realm: 'Whitemane' },
      ledger: SAMPLE_LEDGER,
      unit: 'gold',
      nowMs: NOW,
    });
    expect(report).toContain('Loot ledger — Bobby (Bobbo - Whitemane)');
    expect(report).toContain('Generated 2025-06-15 15:06 UTC');
    expect(report).toContain(
      '#12 | Ashkandi, Greatsword of the Brotherhood | 1,500g | unpaid | 2025-06-15'
    );
    expect(report).toContain('#10 | Netherwind Crown | 800g | paid | 2025-06-14');
    expect(report).toContain('Won auctions: 2');
    expect(report).toContain('Total owed (unpaid): 1,500g');
    expect(report).toContain('Settled (paid/traded): 800g');
    expect(report).toContain('in-game gold/trade only');
  });

  it('renders amounts and the footer in the chosen unit', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      ledger: SAMPLE_LEDGER,
      unit: 'dkp',
      nowMs: NOW,
    });
    expect(report).toContain('#12 | Ashkandi, Greatsword of the Brotherhood | 1,500 DKP | unpaid');
    expect(report).toContain('Total owed (unpaid): 1,500 DKP');
    expect(report).toContain('Settlement is DKP points/trade only — no real-money payments.');
  });

  it('contains no Discord markup so it can be pasted anywhere', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      ledger: SAMPLE_LEDGER,
      nowMs: NOW,
    });
    expect(report).not.toMatch(/<@|\*\*|```|__|~~/);
  });

  it('omits the character suffix for unregistered users', () => {
    const report = buildLedgerTextReport({ displayName: 'Bobby', ledger: SAMPLE_LEDGER, nowMs: NOW });
    expect(report.split('\n')[0]).toBe('Loot ledger — Bobby');
  });

  it('renders an empty ledger', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      ledger: { entries: [], totalOwed: 0, totalSettled: 0 },
      nowMs: NOW,
    });
    expect(report).toContain('No won auctions yet.');
    expect(report).not.toContain('Total owed');
  });

  it('shows a dash for entries without a close date', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      ledger: {
        entries: [
          {
            auction_id: 1,
            item_name: 'Mystery Loot',
            final_price: 100,
            closed_at: null,
            settlement_status: 'unpaid',
          },
        ],
        totalOwed: 100,
        totalSettled: 0,
      },
      unit: 'gold',
      nowMs: NOW,
    });
    expect(report).toContain('#1 | Mystery Loot | 100g | unpaid | —');
  });

  it('defaults the generated timestamp to now', () => {
    const report = buildLedgerTextReport({
      displayName: 'Bobby',
      ledger: { entries: [], totalOwed: 0, totalSettled: 0 },
    });
    expect(report).toMatch(/Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });
});
