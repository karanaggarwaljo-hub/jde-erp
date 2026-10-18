/**
 * Exercises the cash book's server code against one company: makes sure it has a cash drawer,
 * records a test counter payment, reads the book back, then removes the test entry again.
 *
 *   npx tsx --env-file=.env.local scripts/check-cash-book.ts <companyId>
 *
 * Use a test company: it writes (and then deletes) one money entry.
 */
import { deleteMoneyEntriesFor, getMoneySource } from '../lib/db';
import { ensureMoneyAccounts, recordMoney, resolveMoney } from '../lib/cash-book';
import { accountBalances, bookRows, unplacedRows } from '../lib/money-book';

async function main() {
  const companyId = process.argv[2];
  if (!companyId) throw new Error('Pass a company id.');
  const accounts = await ensureMoneyAccounts(companyId);
  console.log('accounts', accounts.map((account) => `${account.name} (${account.kind}) from ${account.opening_date}`));

  console.log('upi with no bank account →', await resolveMoney(companyId, { method: 'upi' }));
  console.log('nothing chosen →', await resolveMoney(companyId, undefined));
  console.log('foreign account id →', await resolveMoney(companyId, { method: 'cash', accountId: '00000000-0000-0000-0000-000000000000' }));

  const before = await getMoneySource(companyId);
  const beforeRows = bookRows(before);
  const cash = before.accounts.find((account) => account.kind === 'cash')!;
  const beforeBalance = accountBalances(before.accounts, beforeRows)[cash.id].balance;

  await recordMoney(companyId, 'check-script', {
    kind: 'sale_counter', date: new Date().toISOString().slice(0, 10), amount: 1234.5, raw: { method: 'cash' },
    sourceType: 'invoice', sourceId: 'CHECK-CASH-BOOK', party: 'check script',
  });
  const after = await getMoneySource(companyId);
  const afterRows = bookRows(after);
  const afterBalance = accountBalances(after.accounts, afterRows)[cash.id].balance;
  console.log(`cash drawer: ${beforeBalance} → ${afterBalance} (expected +1234.5)`);
  console.log('rows', beforeRows.length, '→', afterRows.length, '| unplaced', unplacedRows(afterRows).length,
    unplacedRows(afterRows).slice(0, 5).map((row) => `${row.what} ${row.amount} ${row.date}`));

  const removed = await deleteMoneyEntriesFor(companyId, 'invoice', 'CHECK-CASH-BOOK');
  const cleaned = await getMoneySource(companyId);
  console.log('removed test entries:', removed, '| rows now', bookRows(cleaned).length);
}

main().catch((error) => { console.error(error); process.exit(1); });
