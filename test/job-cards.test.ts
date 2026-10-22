import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanJobInput, daysBetween, jobBill, jobBillLink, jobReference, jobState, readJobLink, sortJobs, type JobCard } from '../lib/job-cards';

const job = (overrides: Partial<JobCard> = {}): JobCard => ({
  id: 'j1', job_no: 'JOB-1001', customer: 'RKCPL LTD', machine: 'JCB 3DX', machine_no: 'PB65 AB 1234', complaint: '', notes: '',
  status: 'open', opened_on: '2026-10-20', ready_on: null, invoice_id: null, ...overrides,
});

/** The owner's case: a machine in for 3-4 days, parts taken meanwhile, paid in full at the end. */
test('a job is billed once its draft bill is confirmed, whatever the job card last said', () => {
  const draft = { id: 'INV-1', status: 'draft', total: 100, paid: 0 };
  const live = { id: 'INV-1', status: 'unpaid', total: 100, paid: 0 };
  assert.equal(jobState(job({ invoice_id: 'INV-1' }), draft), 'open');
  assert.equal(jobState(job({ invoice_id: 'INV-1', status: 'ready' }), draft), 'ready');
  assert.equal(jobState(job({ invoice_id: 'INV-1', status: 'ready' }), live), 'billed');
  assert.equal(jobState(job({ status: 'cancelled' }), null), 'cancelled');
  // A cancelled bill does not count as billing the job.
  assert.equal(jobState(job({ invoice_id: 'INV-1' }), { ...live, status: 'cancelled' }), 'open');
});

test('a job whose draft bill was deleted simply has no bill', () => {
  assert.equal(jobBill(job({ invoice_id: 'INV-9' }), new Map()), null);
  assert.equal(jobBill(job(), new Map([['INV-9', { id: 'INV-9', status: 'draft', total: 1, paid: 0 }]])), null);
});

test('the bill names the job and machine in Other Reference, and Sales links carry the job and purpose', () => {
  assert.equal(jobReference(job()), 'Job JOB-1001, JCB 3DX PB65 AB 1234');
  assert.equal(jobReference(job({ machine: '', machine_no: '' })), 'Job JOB-1001');
  assert.equal(jobBillLink(job(), 'bill'), '/sales?job=j1&for=bill');
  assert.deepEqual(readJobLink('?job=j1&for=bill'), { jobId: 'j1', purpose: 'bill' });
  assert.deepEqual(readJobLink('?job=j1'), { jobId: 'j1', purpose: 'parts' });
  assert.equal(readJobLink('?record=sale'), null);
});

test('machines in the shop come first, longest waiting first; days in are whole days', () => {
  const rows = [
    { job: job({ id: 'a', job_no: 'JOB-1003', opened_on: '2026-10-22' }), state: 'open' as const },
    { job: job({ id: 'b', job_no: 'JOB-1001', opened_on: '2026-10-01' }), state: 'billed' as const },
    { job: job({ id: 'c', job_no: 'JOB-1002', opened_on: '2026-10-20' }), state: 'open' as const },
    { job: job({ id: 'd', job_no: 'JOB-1004', opened_on: '2026-10-21' }), state: 'ready' as const },
  ];
  assert.deepEqual(sortJobs(rows).map((row) => row.job.id), ['c', 'a', 'd', 'b']);
  assert.equal(daysBetween('2026-10-20', '2026-10-23'), 3);
  assert.equal(daysBetween('2026-10-23', '2026-10-20'), 0);
});

test('a new job card needs a customer and the date it came in', () => {
  const base = { customer: '  Sharma  ', machine: ' JCB 3DX ', machine_no: '', complaint: 'leak', notes: '', opened_on: '2026-10-23' };
  const ok = cleanJobInput(base);
  assert.ok(ok.ok && ok.row.customer === 'Sharma' && ok.row.machine === 'JCB 3DX');
  assert.deepEqual(cleanJobInput({ ...base, customer: ' ' }), { ok: false, error: 'Choose or type the customer.' });
  assert.equal(cleanJobInput({ ...base, opened_on: '' }).ok, false);
});
