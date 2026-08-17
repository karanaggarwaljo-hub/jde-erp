import { dbErrorMessage, createExpense } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { companyId, category, description, amount, date, paidBy, mode } = body ?? {};

  if (typeof companyId !== 'string' || !companyId) {
    return Response.json({ error: 'companyId is required' }, { status: 400 });
  }

  try {
    const expense = await createExpense({
      companyId,
      category: String(category ?? ''),
      description: String(description ?? ''),
      amount: Number(amount) || 0,
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
