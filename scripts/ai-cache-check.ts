/**
 * Proves the AI daily-allowance cache actually behaves, against the real database.
 *
 *   npx tsx scripts/ai-cache-check.ts
 *
 * Runs the real planAiRun / recordAiRun / replayMeta code — not a re-implementation of it — but
 * under a reserved feature key ("__cache_selftest__") that no real feature uses, so it can never
 * disturb a stored forecast, insight or report summary. Every row it creates is deleted again on
 * the way out, including if an assertion fails.
 *
 * Costs nothing: it exercises the bookkeeping only and never calls an AI provider.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    console.error('No .env.local found next to package.json — nothing to check against.');
    process.exit(1);
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
loadEnv();

const FEATURE = '__cache_selftest__';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
}

async function clean(): Promise<void> {
  await admin.from('jde_ai_cache').delete().eq('feature', FEATURE);
}

async function main(): Promise<void> {
  const { planAiRun, recordAiRun, replayMeta, fingerprint, DAILY_ALLOWANCE } = await import('../lib/ai/cache');
  const { getActiveCompanyId, businessDayIst } = await import('../lib/db');

  try {
    await clean();
    const companyId = (await getActiveCompanyId()) ?? '__no_active_company__';
    console.log(`Active company: ${companyId}   business day (IST): ${businessDayIst()}   allowance: ${DAILY_ALLOWANCE}/day\n`);

    console.log('1. Nothing stored yet — must generate, so the panel is never blank');
    let plan = await planAiRun(FEATURE, '', {});
    check('shouldGenerate', plan.shouldGenerate, true);

    console.log('\n2. First generation is recorded and counts as run 1 of 2');
    let meta = await recordAiRun(plan, FEATURE, '', { answer: 'first' }, fingerprint({ n: 1 }));
    check('runs_today', meta.runs_today, 1);
    check('limit_reached', meta.limit_reached, false);
    check('cached', meta.cached, false);

    console.log('\n3. An ordinary page load must NOT generate again — it replays the stored answer');
    plan = await planAiRun(FEATURE, '', {});
    check('shouldGenerate', plan.shouldGenerate, false);
    check('replayed answer', (plan.cached!.payload as { answer: string }).answer, 'first');
    check('replay says cached', replayMeta(plan.cached!).cached, true);

    console.log('\n4. Pressing Refresh may spend the second run');
    plan = await planAiRun(FEATURE, '', { force: true });
    check('shouldGenerate', plan.shouldGenerate, true);
    meta = await recordAiRun(plan, FEATURE, '', { answer: 'second' }, fingerprint({ n: 2 }));
    check('runs_today', meta.runs_today, 2);
    check('limit_reached', meta.limit_reached, true);

    console.log('\n5. THE POINT OF ALL THIS: a third attempt cannot generate, even forced');
    plan = await planAiRun(FEATURE, '', { force: true });
    check('shouldGenerate', plan.shouldGenerate, false);
    check('still serves the latest answer', (plan.cached!.payload as { answer: string }).answer, 'second');
    check('reported as limit reached', replayMeta(plan.cached!).limit_reached, true);

    console.log('\n6. Changed figures cannot bypass the limit either, but ARE reported as stale');
    plan = await planAiRun(FEATURE, '', { fingerprint: fingerprint({ n: 999 }) });
    check('shouldGenerate', plan.shouldGenerate, false);
    check('stale_input flagged', replayMeta(plan.cached!, fingerprint({ n: 999 })).stale_input, true);
    check('matching figures not flagged', replayMeta(plan.cached!, fingerprint({ n: 2 })).stale_input, false);

    console.log('\n7. Allowance resets on a new business day (simulated by ageing the stored row)');
    await admin.from('jde_ai_cache').update({ day_ist: '2020-01-01', generated_at: '2020-01-01T00:00:00Z' })
      .eq('company_id', companyId).eq('feature', FEATURE).eq('variant', '');
    plan = await planAiRun(FEATURE, '', {});
    check('shouldGenerate', plan.shouldGenerate, true);
    check('runsToday reset to 0', plan.runsToday, 0);
    check('full allowance available', plan.remaining, DAILY_ALLOWANCE);

    console.log('\n8. A fresh result younger than the spacing window is not regenerated on its own');
    meta = await recordAiRun(plan, FEATURE, '', { answer: 'today' }, fingerprint({ n: 3 }));
    check('runs_today restarted at 1', meta.runs_today, 1);
    plan = await planAiRun(FEATURE, '', {});
    check('shouldGenerate', plan.shouldGenerate, false);

    console.log('\n9. Company isolation: another company has its own row and its own allowance');
    const otherId = `${companyId}__other`;
    await admin.from('jde_ai_cache').insert({
      company_id: otherId, feature: FEATURE, variant: '', fingerprint: '',
      payload: { answer: 'other-company' }, day_ist: businessDayIst(), runs_on_day: DAILY_ALLOWANCE,
    });
    const mine = await planAiRun(FEATURE, '', {});
    check('this company still sees its own answer', (mine.cached!.payload as { answer: string }).answer, 'today');
    check('this company still has runs left', mine.remaining > 0, true);
    await admin.from('jde_ai_cache').delete().eq('company_id', otherId).eq('feature', FEATURE);
  } finally {
    await clean();
    const { count } = await admin.from('jde_ai_cache').select('*', { count: 'exact', head: true }).eq('feature', FEATURE);
    console.log('');
    console.log(`Cleaned up. Self-test rows remaining: ${count ?? 0}`);
  }

  console.log('');
  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
