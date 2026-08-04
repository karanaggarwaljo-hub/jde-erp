'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '@/components/CompanyProvider';

/** Throws a real Error with the server's message on a failed response, instead of letting
 *  callers hit `res.json()` on a body that may be empty (which fails with an opaque
 *  "Unexpected end of JSON input" that can't be caught meaningfully or shown to the user). */
async function parseJsonOrThrow(res: Response, fallback: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page) — fall through to the generic/status-based message.
    }
  }
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `${fallback} (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export function useCompanyTable<T extends Record<string, unknown>>(table: string) {
  const { activeCompany } = useCompany();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!activeCompany) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/local/${table}?company_id=${encodeURIComponent(activeCompany.id)}`);
      const data = await parseJsonOrThrow(res, 'Failed to load records.');
      setRows(Array.isArray(data) ? (data as T[]) : []);
    } catch (error) {
      // A failed reload shouldn't crash the page (it commonly runs right after a mutation that
      // already succeeded) — log it and leave whatever rows are already showing.
      console.error(`Failed to reload ${table}:`, error);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, table]);

  useEffect(() => {
    const timer = setTimeout(reload, 0);
    return () => clearTimeout(timer);
  }, [reload]);

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
