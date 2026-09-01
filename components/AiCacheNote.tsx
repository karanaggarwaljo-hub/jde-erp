'use client';

/** Shared vocabulary for the three AI panels that now run on a daily allowance rather than
 *  regenerating on every page load. Kept in one place so all three describe the same states in
 *  the same words — an owner should not have to learn three phrasings for one behaviour. */

export type CacheMeta = {
  generated_at: string;
  cached: boolean;
  runs_today: number;
  allowance: number;
  limit_reached: boolean;
  stale_input?: boolean;
  refresh_failed?: boolean;
};

/** Always says when the answer was actually produced. The old cards stamped the browser's clock
 *  at fetch time, which was harmless while every load regenerated and would be a plain lie now. */
export function describeGenerated(meta: CacheMeta | null): string | null {
  if (!meta) return null;
  const at = new Date(meta.generated_at);
  if (Number.isNaN(at.getTime())) return null;

  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() && at.getMonth() === today.getMonth() && at.getFullYear() === today.getFullYear();

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const wasYesterday =
    at.getDate() === yesterday.getDate() && at.getMonth() === yesterday.getMonth() && at.getFullYear() === yesterday.getFullYear();

  if (sameDay) return `Generated ${time}`;
  if (wasYesterday) return `Generated yesterday, ${time}`;
  return `Generated ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

/** The one line that explains why a panel is not regenerating, when there is something to explain.
 *  Returns null when the answer is simply current, so nothing is said for the ordinary case. */
export function cacheNotice(meta: CacheMeta | null): { text: string; tone: 'warn' | 'muted' } | null {
  if (!meta) return null;

  if (meta.refresh_failed) {
    return { text: 'Could not reach the AI just now — showing the last result instead.', tone: 'warn' };
  }
  if (meta.stale_input) {
    return {
      text: meta.limit_reached
        ? 'These figures have changed since this was written, and today’s 2 AI updates are used up. A fresh one is available tomorrow.'
        : 'These figures have changed since this was written. Press Refresh for an up-to-date version.',
      tone: 'warn',
    };
  }
  if (meta.limit_reached) {
    return { text: `Updated ${meta.allowance} times today — the next refresh is available tomorrow.`, tone: 'muted' };
  }
  if (meta.cached) {
    const left = Math.max(0, meta.allowance - meta.runs_today);
    return { text: `Saved result — ${left} AI update${left === 1 ? '' : 's'} left today.`, tone: 'muted' };
  }
  return null;
}

export function AiCacheNote({ meta }: { meta: CacheMeta | null }) {
  const notice = cacheNotice(meta);
  if (!notice) return null;
  return (
    <p
      style={{
        fontSize: '12px',
        marginTop: '8px',
        color: notice.tone === 'warn' ? 'var(--color-warning)' : 'var(--text-muted)',
      }}
    >
      {notice.text}
    </p>
  );
}
