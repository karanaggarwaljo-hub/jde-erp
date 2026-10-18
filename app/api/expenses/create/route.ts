import { dbErrorMessage, createExpense } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';
import { money, recordAudit } from '@/lib/audit-log';
import { placeMoney } from '@/lib/cash-book';
import { methodFromText } from '@/lib/money-book';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, category, description, amount, date, paidBy, mode } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return Response.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  try {
    const expense = await createExpense({
      companyId,
      category: String(category ?? ''),
      description: String(description ?? ''),
      amount: numericAmount,
      date: String(date ?? ''),
      paidBy: String(paidBy ?? ''),
      mode: String(mode ?? ''),
    });
    // Out of the drawer or the bank account chosen. A screen that still sends only the older free-text
    // mode ("cheque", "UPI") has it read as the method.
    if (typeof expense.id === 'string') {
      await placeMoney(companyId, 'expenses', expense.id, body?.money ?? { method: methodFromText(String(mode ?? '')) ?? 'cash' });
    }
    await recordAudit({
      companyId, action: 'expense.create', entity: 'expenses', entityId: typeof expense.id === 'string' ? expense.id : null,
      summary: `Logged an expense of ${money(numericAmount)}${category ? ` for ${String(category)}` : ''}`,
      details: { amount: numericAmount, category: String(category ?? ''), date: String(date ?? '') },
    });
    return Response.json(expense, { status: 201 });
  } catch (error) {
    console.error('POST /api/expenses/create failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to log this expense.') }, { status: 500 });
  }
}
