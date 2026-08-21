'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '@/components/CompanyProvider';
import { fetchGetWithRetry } from '@/lib/fetchGetWithRetry';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

const TABLE_CACHE_TTL_MS = 15_000;

type CachedRows = {
  rows: Record<string, unknown>[];
  expiresAt: number;
  inFlight?: Promise<Record<string, unknown>[]>;
};

// Several persistent UI regions (for example Topbar and Inventory) can ask for the same table
// during the same render. Share that GET and retain the result briefly across client navigation.
// This is browser-memory only: a refresh still reads the database, while writes below force a
// fresh read before publishing the new rows to every mounted consumer.
const tableCache = new Map<string, CachedRows>();
const tableSubscribers = new Map<string, Set<(rows: Record<string, unknown>[]) => void>>();

function cacheKey(table: string, companyId: string): string {
  return `${companyId}:${table}`;
}

function publish(key: string, rows: Record<string, unknown>[]) {
  tableSubscribers.get(key)?.forEach((listener) => listener(rows));
}

function freshRows(key: string): Record<string, unknown>[] | undefined {
  const cached = tableCache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.rows : undefined;
}

async function loadTableRows(table: string, companyId: string, force: boolean): Promise<Record<string, unknown>[]> {
  const key = cacheKey(table, companyId);
  const cached = tableCache.get(key);
  if (!force) {
    const rows = freshRows(key);
    if (rows) return rows;
  }
  // A forced reload after a mutation should still join a request already underway rather than
  // create a second identical GET; the next user action can force another fresh read if needed.
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = (async () => {
    const res = await fetchGetWithRetry(`/api/local/${table}?company_id=${encodeURIComponent(companyId)}`);
    const data = await parseJsonOrThrow(res, 'Failed to load records.');
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    tableCache.set(key, { rows, expiresAt: Date.now() + TABLE_CACHE_TTL_MS });
    publish(key, rows);
    return rows;
  })();

  tableCache.set(key, { rows: cached?.rows ?? [], expiresAt: cached?.expiresAt ?? 0, inFlight });
  try {
    return await inFlight;
  } finally {
    const current = tableCache.get(key);
    if (current?.inFlight === inFlight) {
      tableCache.set(key, { rows: current.rows, expiresAt: current.expiresAt });
    }
  }
}

export function useCompanyTable<T extends Record<string, unknown>>(table: string) {
  const { activeCompany } = useCompany();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force: boolean) => {
    if (!activeCompany) {
      setRows([]);
      setLoading(false);
      return;
    }
    const key = cacheKey(table, activeCompany.id);
    const cached = force ? undefined : freshRows(key);
    if (cached) {
      setRows(cached as T[]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows((await loadTableRows(table, activeCompany.id, force)) as T[]);
    } catch (error) {
      // A failed reload shouldn't crash the page (it commonly runs right after a mutation that
      // already succeeded) — log it and leave whatever rows are already showing.
      console.error(`Failed to reload ${table}:`, error);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, table]);

  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (!activeCompany) return;
    const key = cacheKey(table, activeCompany.id);
    const listener = (nextRows: Record<string, unknown>[]) => setRows(nextRows as T[]);
    let subscribers = tableSubscribers.get(key);
    if (!subscribers) {
      subscribers = new Set();
      tableSubscribers.set(key, subscribers);
    }
    subscribers.add(listener);
    return () => {
      subscribers?.delete(listener);
      if (subscribers?.size === 0) tableSubscribers.delete(key);
    };
  }, [activeCompany, table]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(false); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const create = useCallback(async (data: Record<string, unknown>) => {
    const res = await fetch(`/api/local/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, company_id: activeCompany?.id }),
    });
    const created = await parseJsonOrThrow(res, 'Failed to create record.');
    await reload();
    return created as T;
  }, [table, activeCompany, reload]);

  const update = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/local/${table}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const updated = await parseJsonOrThrow(res, 'Failed to update record.');
    await reload();
    return updated as T;
  }, [table, reload]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/local/${table}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await parseJsonOrThrow(res, 'Failed to delete record.');
    await reload();
  }, [table, reload]);

  /** Atomically adds `delta` to a numeric column (e.g. current_stock, balance) via a database-side
   *  increment, instead of computing `current + delta` in JS and writing the sum back. Only supported
   *  for tables with a matching /api/adjust route (products, customers, suppliers). */
  const adjust = useCallback(async (id: string, delta: number) => {
    const res = await fetch(`/api/adjust/${table}/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    const updated = await parseJsonOrThrow(res, 'Failed to adjust record.');
    await reload();
    return updated as T;
  }, [table, reload]);

  return { rows, setRows, loading, reload, create, update, remove, adjust, activeCompany };
}
