'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '@/components/CompanyProvider';

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
    const res = await fetch(`/api/local/${table}?company_id=${encodeURIComponent(activeCompany.id)}`);
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
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
    const created = await res.json();
    await reload();
    return created as T;
  }, [table, activeCompany, reload]);

  const update = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/local/${table}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    await reload();
    return updated as T;
  }, [table, reload]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/local/${table}/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    const updated = await res.json();
    await reload();
    return updated as T;
  }, [table, reload]);

  return { rows, setRows, loading, reload, create, update, remove, adjust, activeCompany };
}
