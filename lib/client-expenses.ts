export type CreateExpenseInput = {
  companyId: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paidBy: string;
  mode: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page) — fall through to the generic/status-based message.
    }
  }
  if (!res.ok) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `${url} failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

/** Records a new expense with a server-generated id, instead of guessing one client-side from
 *  whichever company's rows happen to already be loaded (id is globally unique across every
 *  company on this account, not scoped per company). */
export function createExpense(input: CreateExpenseInput) {
  return postJson<Record<string, unknown>>('/api/expenses/create', input);
}
