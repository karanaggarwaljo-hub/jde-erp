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
  configError: string | null;
  refresh: () => Promise<void>;
  switchCompany: (id: string) => Promise<void>;
  setStorefrontCompany: (id: string) => Promise<void>;
  addCompany: (data: NewCompanyInput) => Promise<Company>;
  updateCompany: (id: string, data: Partial<NewCompanyInput>) => Promise<void>;
  removeCompany: (id: string) => Promise<{ ok: true } | { error: string }>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

/** Mirrors lib/useCompanyTable.ts's parseJsonOrThrow — duplicated rather than imported because
 *  useCompanyTable.ts itself imports useCompany from this module, and importing the other way
 *  round would create a circular dependency (same reasoning as app/catalog/[id]/page.tsx's
 *  duplicated buildWhatsAppUrl). Reads the body as text first and parses defensively, so a
 *  failed response (including an empty 500 body from an unhandled server error) throws a real
 *  Error with the server's message instead of letting callers hit res.json() directly and blow
 *  up with an opaque "Unexpected end of JSON input". */
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
