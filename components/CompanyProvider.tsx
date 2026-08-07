'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

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

  const refresh = useCallback(async () => {
    const res = await fetch('/api/companies/active');
    const body = await res.json();
    setCompanies(body.companies ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const switchCompany = useCallback(async (id: string) => {
    await fetch(`/api/companies/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const setStorefrontCompany = useCallback(async (id: string) => {
    await fetch(`/api/companies/${encodeURIComponent(id)}/set-storefront`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const addCompany = useCallback(async (data: NewCompanyInput) => {
    const res = await fetch('/api/local/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, is_active: 0 }),
    });
    const created = await res.json();
    await refresh();
    return created as Company;
  }, [refresh]);

  const updateCompany = useCallback(async (id: string, data: Partial<NewCompanyInput>) => {
    await fetch(`/api/local/companies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await refresh();
  }, [refresh]);

  const removeCompany = useCallback(async (id: string) => {
    const res = await fetch(`/api/local/companies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const body = await res.json();
    await refresh();
    if (!res.ok) return { error: body.error as string };
    return { ok: true as const };
  }, [refresh]);

  const activeCompany = companies.find((c) => c.is_active) ?? null;

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, loading, refresh, switchCompany, setStorefrontCompany, addCompany, updateCompany, removeCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within a CompanyProvider');
  return ctx;
}
