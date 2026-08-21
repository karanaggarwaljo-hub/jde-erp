import { aiErrorResponse, generateJson } from '@/lib/ai/generate';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['rent', 'salaries', 'utilities', 'transport', 'maintenance', 'office', 'other'] as const;

const CATEGORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
  },
  required: ['category'],
};

const SYSTEM_PROMPT =
  `You categorize operational expenses for an Indian auto spare parts trading business. Given a short free-text ` +
  `description, pick exactly one category from: ${CATEGORIES.join(', ')}. "transport" means freight/courier/delivery/fuel ` +
  `costs, "office" means stationery/office supplies/small equipment, "other" is only for genuinely ambiguous cases.`;

export async function POST(request: Request) {
  const { description } = await request.json();
  if (typeof description !== 'string' || !description.trim()) {
    return Response.json({ error: 'description is required' }, { status: 400 });
  }

  try {
    const { data } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: `Expense description: "${description}"`,
      schema: CATEGORY_JSON_SCHEMA,
      schemaName: 'expense_category',
      // Someone is waiting on a field to fill in — lead with the fastest provider.
      priority: 'speed',
    });
    return Response.json(data);
  } catch (error) {
    console.error('ai-categorize-expense route failed:', error);
    return aiErrorResponse(error, 'Unknown error categorizing expense.');
  }
}
