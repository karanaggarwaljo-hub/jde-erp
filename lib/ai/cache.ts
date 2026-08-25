import { createHash } from 'node:crypto';
import { businessDayIst, getActiveCompanyId, readAiCache, writeAiCache, type AiCacheRow } from '@/lib/db';

/** How many times a day one AI feature may actually call a provider, per company.
 *
 *  The reason this exists: every one of these features regenerated from scratch on every page
 *  load, and the report summary regenerated on every tab switch — five report tabs meant five
 *  calls just to look around. The free provider tiers here are small (Gemini's newest models
 *  allow as few as 20 requests a day; Groq caps tokens per minute), so idle browsing was
 *  consuming the same allowance the owner actually needs when they want an answer. */
export const DAILY_ALLOWANCE = 2;

/** A result younger than this is simply shown again rather than regenerated, so the day's two
 *  runs land morning-and-evening instead of both being spent within a minute of each other. */
export const REFRESH_AFTER_HOURS = 12;

export type CacheMeta = {
  /** When the shown answer was actually produced — the server's time, never the browser's. */
  generated_at: string;
  /** True when this response was replayed rather than generated just now. */
  cached: boolean;
  runs_today: number;
  allowance: number;
  /** True when today's runs are used up, so Refresh cannot produce anything new until tomorrow. */
  limit_reached: boolean;
  /** Only meaningful where a fingerprint is supplied: the figures have moved since this answer
   *  was written, so it must not be presented as describing what is on screen now. */
  stale_input?: boolean;
  /** A generation was attempted and failed, and this stored answer is being shown instead of an
   *  error. The reader is told, rather than being left to assume it is current. */
  refresh_failed?: boolean;
};

/** Key ordering must not change the fingerprint, or every request would look like new input. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stable(source[key]);
        return acc;
      }, {});
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 32);
}

const hoursSince = (iso: string): number => (Date.now() - new Date(iso).getTime()) / 3_600_000;

export type AiRunPlan = {
  companyId: string;
  cached?: AiCacheRow;
  shouldGenerate: boolean;
  runsToday: number;
  remaining: number;
};

/** Decides whether this request may call a provider, or must replay the stored answer. */
export async function planAiRun(
  feature: string,
  variant = '',
  opts: { force?: boolean; fingerprint?: string } = {}
): Promise<AiRunPlan> {
  const { force = false, fingerprint: currentFingerprint } = opts;
  // Never fall back to a shared key: a blank company id would pool every company's answers into
  // one row, which is both wrong and a data-isolation problem.
  const companyId = (await getActiveCompanyId()) ?? '__no_active_company__';
  const cached = await readAiCache(companyId, feature, variant);

  const runsToday = cached && cached.day_ist === businessDayIst() ? cached.runs_on_day : 0;
  const remaining = Math.max(0, DAILY_ALLOWANCE - runsToday);

  let shouldGenerate: boolean;
  if (!cached) {
    shouldGenerate = true; // Nothing to show at all — an empty panel helps no one.
  } else if (remaining === 0) {
    shouldGenerate = false;
  } else if (force) {
    shouldGenerate = true; // An explicit Refresh spends the allowance the owner asked to spend.
  } else if (currentFingerprint !== undefined && cached.fingerprint !== currentFingerprint) {
    // The figures this answer described have changed. Regenerating is worth an attempt here,
    // because the alternative is prose sitting beside numbers it does not match.
    shouldGenerate = true;
  } else {
    shouldGenerate = hoursSince(cached.generated_at) >= REFRESH_AFTER_HOURS;
  }

  return { companyId, cached, shouldGenerate, runsToday, remaining };
}

/** Records a successful generation. Only called on success, so an outage never costs an attempt. */
export async function recordAiRun(
  plan: AiRunPlan,
  feature: string,
  variant: string,
  payload: unknown,
  inputFingerprint = ''
): Promise<CacheMeta> {
  const row = await writeAiCache(plan.companyId, feature, variant, inputFingerprint, payload);
  return {
    generated_at: row.generated_at,
    cached: false,
    runs_today: row.runs_on_day,
    allowance: DAILY_ALLOWANCE,
    limit_reached: row.runs_on_day >= DAILY_ALLOWANCE,
  };
}

/** Describes a replayed answer. `currentFingerprint` is compared against the one stored with the
 *  answer so the caller can tell the difference between "still accurate" and "the numbers moved". */
export function replayMeta(row: AiCacheRow, currentFingerprint?: string): CacheMeta {
  const runsToday = row.day_ist === businessDayIst() ? row.runs_on_day : 0;
  return {
    generated_at: row.generated_at,
    cached: true,
    runs_today: runsToday,
    allowance: DAILY_ALLOWANCE,
    limit_reached: runsToday >= DAILY_ALLOWANCE,
    ...(currentFingerprint !== undefined ? { stale_input: row.fingerprint !== currentFingerprint } : {}),
  };
}
