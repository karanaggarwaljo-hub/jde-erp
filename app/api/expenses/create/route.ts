import { dbErrorMessage, createExpense } from '@/lib/db';
import { checkCompanyAccess } from '@/lib/auth/dal';

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
    return Response.json(expense, { status: 201 });
  } catch (error) {
    console.error('POST /api/expenses/create failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'Failed to log this expense.') }, { status: 500 });
  }
}
