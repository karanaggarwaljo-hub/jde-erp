'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

export type Company = {
  id: string;
  name: string;
  gstin: string;
  invoice_prefix: string;
  po_prefix: string;
  address: string;
  is_active: boolean;
  is_storefront?: boolean;
  contact_email?: string | null;
  contact_phone?: string | null;
};

type NewCompanyInput = { name: string; gstin: string; invoice_prefix: string; po_prefix: string; address: string; contact_email?: string; contact_phone?: string };

type CompanyContextValue = {
  companies: Company[];
  activeCompany: Company | null;
  loading: boolean;
  configError: string | null;
  refresh: () => Promise<void>;
  switchCompany: (id: string) => Promise<void>;
  setStorefrontCompany: (id: string) => Promise<void>;
  addCompany: (data: NewCompanyInput) => Promise<Company>;
  updateCompany: (id: string, data: Partial<NewCompanyInput>) => Promise<void>;
  removeCompany: (id: string) => Promise<{ ok: true } | { error: string }>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/companies/active');
      const body = (await parseJsonOrThrow(res, 'Failed to load company data.')) as { companies?: Company[] } | undefined;
      setCompanies(body?.companies ?? []);
      setConfigError(null);
    } catch (error) {
      // Mirrors useCompanyTable's reload(): a failed refresh shouldn't wipe out whatever company
      // list is already showing (this can run again after a mutation that already succeeded) —
      // log it, surface configError for pages that check it, and leave `companies` untouched so
      // pages don't misread a transient refresh failure as "zero companies exist".
      console.error('Failed to load active company:', error);
      setConfigError(error instanceof Error ? error.message : 'Failed to load company data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // Every mutation below used to fire its request and call refresh() without ever looking at
  // whether the request actually succeeded — a failed switch/update/add silently "succeeded"
  // from the caller's point of view (refresh() would just show whatever's actually true, with
  // no error surfaced anywhere). parseJsonOrThrow makes each of these genuinely throw on failure.

  const switchCompany = useCallback(async (id: string) => {
    const res = await fetch(`/api/companies/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    await parseJsonOrThrow(res, 'Failed to switch the active company.');
    await refresh();
  }, [refresh]);

  const setStorefrontCompany = useCallback(async (id: string) => {
    const res = await fetch(`/api/companies/${encodeURIComponent(id)}/set-storefront`, { method: 'POST' });
    await parseJsonOrThrow(res, 'Failed to set the storefront company.');
    await refresh();
  }, [refresh]);

  const addCompany = useCallback(async (data: NewCompanyInput) => {
    const res = await fetch('/api/local/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, is_active: 0 }),
    });
    const created = await parseJsonOrThrow(res, 'Failed to add company.');
    await refresh();
    return created as Company;
  }, [refresh]);

  const updateCompany = useCallback(async (id: string, data: Partial<NewCompanyInput>) => {
    const res = await fetch(`/api/local/companies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonOrThrow(res, 'Failed to update company.');
    await refresh();
  }, [refresh]);

  // Kept as a returned {error} rather than a throw, unlike the mutations above — deleting a
  // company is destructive enough that its caller (a confirmation dialog) wants to keep the
  // dialog open and show the error in place, not unwind via a catch block.
  const removeCompany = useCallback(async (id: string) => {
    const res = await fetch(`/api/local/companies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    try {
      await parseJsonOrThrow(res, 'Failed to delete company.');
      return { ok: true as const };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to delete company.' };
    } finally {
      await refresh();
    }
  }, [refresh]);

  const activeCompany = companies.find((c) => c.is_active) ?? null;

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, loading, configError, refresh, switchCompany, setStorefrontCompany, addCompany, updateCompany, removeCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within a CompanyProvider');
  return ctx;
}
