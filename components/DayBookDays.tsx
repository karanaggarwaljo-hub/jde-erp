'use client';

/**
 * The day book's days, as tables.
 *
 * Split out from the page so it can be rendered and read back without a company context or a
 * login — this is the part with the money in it, and the page around it is filters and a fetch.
 */

import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { paise } from '@/lib/money';
import { DAYBOOK_LABELS, type DayBookDay, type DayBookKind } from '@/lib/daybook';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-12" -> "12 Sep 2026", with today and yesterday named rather than dated. `today` is
 *  passed in rather than read from the clock so the same input always renders the same output. */
export function niceDate(isoDate: string, today: string): string {
  if (isoDate === today) return 'Today';
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (isoDate === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  const [year, month, day] = isoDate.split('-');
  const monthName = MONTHS[Number(month) - 1];
  return monthName ? `${Number(day)} ${monthName} ${year}` : isoDate;
}

const KIND_TONE: Record<DayBookKind, string> = {
  sale: 'badge-success',
  receipt: 'badge-success',
  purchase: 'badge-muted',
  'supplier-payment': 'badge-muted',
  expense: 'badge-muted',
  'sales-return': 'badge-danger',
  'purchase-return': 'badge-danger',
  settlement: 'badge-warning',
};

export default function DayBookDays({ days, today }: { days: DayBookDay[]; today: string }) {
  return (
    <>
      {days.map((day) => (
        <div key={day.date} className="card mb-4">
          <div className="tbl-toolbar">
            <div className="tbl-toolbar-title">
              <strong>{niceDate(day.date, today)}</strong>
              <small>{day.totals.entryCount} {day.totals.entryCount === 1 ? 'transaction' : 'transactions'}</small>
            </div>
            <div className="flex gap-3 items-center" style={{ flexWrap: 'wrap' }}>
              <span className="text-success text-sm flex items-center gap-1"><ArrowDownLeft size={13} /> ₹{paise(day.totals.cashIn)} in</span>
              <span className="text-danger text-sm flex items-center gap-1"><ArrowUpRight size={13} /> ₹{paise(day.totals.cashOut)} out</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="erp-table" style={{ minWidth: '760px' }}>
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Type</th>
                  <th style={{ width: '130px' }}>Number</th>
                  <th>Who / what</th>
                  <th className="text-right" style={{ width: '130px' }}>Value</th>
                  <th className="text-right" style={{ width: '130px' }}>Money in</th>
                  <th className="text-right" style={{ width: '130px' }}>Money out</th>
                </tr>
              </thead>
              <tbody>
                {day.entries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
                    <td><span className={'badge ' + KIND_TONE[entry.kind]}>{DAYBOOK_LABELS[entry.kind]}</span></td>
                    <td>
                      {entry.href
                        ? <Link href={entry.href} className="pn-chip" target="_blank">{entry.reference}</Link>
                        : <span className="pn-chip">{entry.reference}</span>}
                    </td>
                    <td>
                      <strong style={{ fontSize: '13px' }}>{entry.party}</strong>
                      <div className="text-muted text-sm">{entry.detail}</div>
                    </td>
                    <td className="text-right font-semibold">₹{paise(entry.value)}</td>
                    <td className="text-right">
                      {entry.cashIn > 0 ? <strong className="text-success">₹{paise(entry.cashIn)}</strong> : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-right">
                      {entry.cashOut > 0 ? <strong className="text-danger">₹{paise(entry.cashOut)}</strong> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
