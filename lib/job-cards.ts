/**
 * Job cards: a machine in for repair over several days. The customer takes parts while it is in;
 * once it is repaired they pay for the whole job at once.
 *
 * A job card holds only the job's own details (customer, machine, complaint). Its parts are kept on
 * one draft bill, linked by `invoice_id`: the bill form already reserves a draft's stock, lets parts
 * be added day by day, and turns the draft into the final tax invoice when the customer pays. So a
 * job is never billed twice and its stock is never counted twice.
 *
 * Pure; the screen is app/(dashboard)/jobs, the table jde_job_cards (scripts/job-cards.sql).
 */

import { CANCELLED_STATUS, DRAFT_STATUS } from './sales-types';

export type JobCard = {
  id: string;
  job_no: string;
  customer: string;
  machine: string;
  machine_no: string;
  complaint: string;
  notes: string;
  status: 'open' | 'ready' | 'cancelled';
  opened_on: string;
  ready_on: string | null;
  invoice_id: string | null;
  created_at?: string;
};

export type JobBill = { id: string; status: string; total: number | string; paid: number | string };

export type JobState = 'open' | 'ready' | 'billed' | 'cancelled';

export const JOB_STATE_LABELS: Record<JobState, string> = {
  open: 'In repair',
  ready: 'Ready, not billed',
  billed: 'Billed',
  cancelled: 'Cancelled',
};

/** The bill linked to a job, if it still exists (a deleted draft leaves the job with no parts). */
export function jobBill(job: JobCard, bills: Map<string, JobBill>): JobBill | null {
  return job.invoice_id ? bills.get(job.invoice_id) ?? null : null;
}

/** Where a job stands. Billed is read from its bill rather than stored: once the draft is confirmed
 *  the job is billed, whatever the job card itself last said. */
export function jobState(job: JobCard, bill: JobBill | null): JobState {
  if (bill && bill.status !== DRAFT_STATUS && bill.status !== CANCELLED_STATUS) return 'billed';
  if (job.status === 'cancelled') return 'cancelled';
  return job.status === 'ready' ? 'ready' : 'open';
}

/** Whole days between two YYYY-MM-DD dates, never negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

/** "Other Reference" on the bill, so the customer's invoice names the job and the machine. */
export function jobReference(job: Pick<JobCard, 'job_no' | 'machine' | 'machine_no'>): string {
  const machine = [job.machine.trim(), job.machine_no.trim()].filter(Boolean).join(' ');
  return (machine ? `Job ${job.job_no}, ${machine}` : `Job ${job.job_no}`).slice(0, 120);
}

/** The Sales address that opens a job's bill: to add parts (kept as a draft) or to bill it. */
export function jobBillLink(job: Pick<JobCard, 'id'>, purpose: 'parts' | 'bill'): string {
  return `/sales?job=${encodeURIComponent(job.id)}&for=${purpose}`;
}

/** What a Sales address asks of a job, or null when it names none. */
export function readJobLink(search: string): { jobId: string; purpose: 'parts' | 'bill' } | null {
  const params = new URLSearchParams(search);
  const jobId = params.get('job');
  if (!jobId) return null;
  return { jobId, purpose: params.get('for') === 'bill' ? 'bill' : 'parts' };
}

/** Open jobs first (oldest first, the ones waiting longest), then ready, then billed and
 *  cancelled (newest first). */
export function sortJobs<T extends { job: JobCard; state: JobState }>(rows: T[]): T[] {
  const rank: Record<JobState, number> = { open: 0, ready: 1, billed: 2, cancelled: 3 };
  return [...rows].sort((a, b) => rank[a.state] - rank[b.state]
    || (a.state === 'open' || a.state === 'ready'
      ? a.job.opened_on.localeCompare(b.job.opened_on)
      : b.job.opened_on.localeCompare(a.job.opened_on))
    || a.job.job_no.localeCompare(b.job.job_no));
}

/** A new job card's fields, cleaned to what the table accepts. Null with a reason when unusable. */
export function cleanJobInput(input: { customer: string; machine: string; machine_no: string; complaint: string; notes: string; opened_on: string }):
  { ok: true; row: Omit<JobCard, 'id' | 'job_no' | 'status' | 'ready_on' | 'invoice_id' | 'created_at'> } | { ok: false; error: string } {
  const customer = input.customer.trim().slice(0, 120);
  if (!customer) return { ok: false, error: 'Choose or type the customer.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.opened_on)) return { ok: false, error: 'Pick the date the machine came in.' };
  return {
    ok: true,
    row: {
      customer,
      machine: input.machine.trim().slice(0, 120),
      machine_no: input.machine_no.trim().slice(0, 60),
      complaint: input.complaint.trim().slice(0, 500),
      notes: input.notes.trim().slice(0, 1000),
      opened_on: input.opened_on,
    },
  };
}
