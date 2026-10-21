/**
 * Runs the nightly Drive work for one company now: its backup into Google Drive, then the parts
 * catalogue (photos and the Parts list sheet). Prints what happened. Safe to run again: an
 * existing backup for today is left alone, and unchanged photos and sheets are not sent again.
 *
 *   npx tsx --env-file=.env.local scripts/check-drive-catalogue.ts <companyId>
 */
import { backupCompanyToDrive } from '../lib/drive-backup';
import { syncPartsToDrive } from '../lib/parts-drive';
import { shopDay } from '../lib/logbook';

async function main() {
  const companyId = process.argv[2];
  if (!companyId) throw new Error('Pass a company id.');
  const today = shopDay(new Date());
  let started = Date.now();
  console.log('backup:', await backupCompanyToDrive(companyId, today), `(${Date.now() - started} ms)`);
  console.log('backup again (should be null, already there):', await backupCompanyToDrive(companyId, today));
  started = Date.now();
  console.log('parts:', JSON.stringify(await syncPartsToDrive(companyId, 40_000)), `(${Date.now() - started} ms)`);
  console.log('parts again (sheet should be unchanged):', JSON.stringify(await syncPartsToDrive(companyId, 40_000)));
}

main().catch((error) => { console.error(error); process.exit(1); });
