export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { backupIfNeededToday, pruneOldBackups } = await import('@/lib/db/backup');

  const runCheck = async () => {
    try {
      const result = await backupIfNeededToday();
      if (result) console.log(`[backup] created ${result.filename}`);
      const deleted = pruneOldBackups();
      if (deleted.length > 0) console.log(`[backup] pruned ${deleted.length} backup(s) older than 7 days`);
    } catch (err) {
      console.error('[backup] failed:', err);
    }
  };

  runCheck();
  setInterval(runCheck, 60 * 60 * 1000);
}
