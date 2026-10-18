/**
 * Stock planning: what to reorder before it runs out, and what is sitting on the shelf not
 * selling. Pure — the screen hands it the rows it already loads.
 *
 *   Reorder    How fast each part actually sells (pieces billed over the last `windowDays`),
 *              how many days the stock on the shelf lasts at that pace, and how many to order
 *              so it lasts the supplier's lead time plus the days you want covered. A part's own
 *              "reorder at" level (min_stock) is respected as a floor. Parts that never sold and
 *              have no reorder level are left alone — there is nothing to plan from.
 *
 *   Dead stock Parts in stock that have not sold in `deadDays` (or never sold), with what that
 *              stock cost — the money tied up on the shelf.
 *
 * Drafts are not sales. Customer returns are not taken off the pace: a return is rare next to the
 * sales around it, and the screen says so.
 */

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

export type PlanPart = {
  id: string;
  part_number?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  current_stock: number | string | null;
  min_stock?: number | string | null;
  cost_price?: number | string | null;
};
export type PlanSale = { product_id: string | null; qty: number | string; date: string };
export type PlanBatch = { product_id: string; qty_remaining: number | string; unit_cost: number | string; source_po_id: string | null; created_at: string };
export type PlanPurchase = { id: string; supplier: string; date: string };

export type PlanSettings = {
  /** How far back sales are counted to judge the pace. */
  windowDays: number;
  /** Days between ordering and the stock arriving. */
  leadDays: number;
  /** Days of sales an order should cover once it arrives. */
  coverDays: number;
  /** No sale in this many days counts as dead stock. */
  deadDays: number;
};
export const DEFAULT_PLAN_SETTINGS: PlanSettings = { windowDays: 90, leadDays: 7, coverDays: 30, deadDays: 90 };

export type PartPlan = {
  partId: string;
  partNumber: string;
  name: string;
  category: string;
  brand: string;
  onHand: number;
  reorderAt: number;
  soldInWindow: number;
  perDay: number;
  /** How long the stock on the shelf lasts at the current pace. Null when it is not selling. */
  daysLeft: number | null;
  needsReorder: boolean;
  suggestQty: number;
  lastCost: number;
  lastSupplier: string | null;
  lastSoldDate: string | null;
  /** Days since the last sale, or since the oldest stock on the shelf came in when never sold. */
  idleDays: number | null;
  stockValue: number;
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / 86_400_000)) : 0;
}

export function planParts(input: {
  parts: PlanPart[];
  sales: PlanSale[];
  batches: PlanBatch[];
  purchases: PlanPurchase[];
  today: string;
  settings?: Partial<PlanSettings>;
}): PartPlan[] {
  const settings = { ...DEFAULT_PLAN_SETTINGS, ...input.settings };
  const windowStart = new Date(Date.parse(`${input.today}T00:00:00Z`) - (settings.windowDays - 1) * 86_400_000).toISOString().slice(0, 10);

  const soldInWindow = new Map<string, number>();
  const lastSold = new Map<string, string>();
  for (const sale of input.sales) {
    if (!sale.product_id) continue;
    const day = sale.date.slice(0, 10);
    if (day > input.today) continue;
    if (day >= windowStart) soldInWindow.set(sale.product_id, (soldInWindow.get(sale.product_id) ?? 0) + num(sale.qty));
    if ((lastSold.get(sale.product_id) ?? '') < day) lastSold.set(sale.product_id, day);
  }

  const purchasesById = new Map(input.purchases.map((purchase) => [purchase.id, purchase]));
  const batchesByPart = new Map<string, PlanBatch[]>();
  for (const batch of input.batches) {
    const list = batchesByPart.get(batch.product_id) ?? [];
    list.push(batch);
    batchesByPart.set(batch.product_id, list);
  }

  return input.parts.map((part) => {
    const onHand = num(part.current_stock);
    const reorderAt = Math.max(0, num(part.min_stock));
    const sold = soldInWindow.get(part.id) ?? 0;
    const perDay = sold / settings.windowDays;
    const daysLeft = perDay > 0 ? Math.floor(Math.max(0, onHand) / perDay) : null;

    const batches = [...(batchesByPart.get(part.id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const bought = batches.find((batch) => batch.source_po_id && purchasesById.has(batch.source_po_id));
    const latestPriced = batches.find((batch) => num(batch.unit_cost) > 0);
    const lastCost = round2(num(latestPriced?.unit_cost) || num(part.cost_price));
    const layered = batches.reduce((total, batch) => total + Math.max(0, num(batch.qty_remaining)) * num(batch.unit_cost), 0);
    const stockValue = round2(layered > 0 ? layered : Math.max(0, onHand) * num(part.cost_price));

    // Order when the shelf will not last the supplier's lead time at the current pace, or has come
    // down to the part's own reorder level. Not by rounding a tiny pace up to "keep one": a part
    // selling once a year with one on the shelf has a year left, and is not urgent.
    // The order is enough for the lead time plus the days to cover, and at least back up to twice
    // the reorder level when the part has one.
    const target = Math.max(reorderAt > 0 ? reorderAt * 2 : 0, Math.ceil(perDay * (settings.leadDays + settings.coverDays)));
    const needsReorder = (reorderAt > 0 && onHand <= reorderAt) || (perDay > 0 && onHand < perDay * settings.leadDays);
    const suggestQty = needsReorder ? Math.max(1, Math.ceil(target - Math.max(0, onHand))) : 0;

    const lastSoldDate = lastSold.get(part.id) ?? null;
    const oldestStocked = batches.filter((batch) => num(batch.qty_remaining) > 0).map((batch) => batch.created_at.slice(0, 10)).sort()[0] ?? null;
    const idleSince = lastSoldDate ?? oldestStocked;

    return {
      partId: part.id,
      partNumber: (part.part_number ?? '').trim(),
      name: part.name,
      category: (part.category ?? '').trim(),
      brand: (part.brand ?? '').trim(),
      onHand,
      reorderAt,
      soldInWindow: round2(sold),
      perDay: round2(perDay),
      daysLeft,
      needsReorder,
      suggestQty,
      lastCost,
      lastSupplier: bought ? purchasesById.get(bought.source_po_id!)!.supplier : null,
      lastSoldDate,
      idleDays: idleSince ? daysBetween(idleSince, input.today) : null,
      stockValue,
    };
  });
}

/** Parts to order, the most urgent first: out of stock, then fewest days left. */
export function reorderList(plans: PartPlan[]): PartPlan[] {
  const urgency = (plan: PartPlan) => (plan.onHand <= 0 ? -1 : plan.daysLeft ?? Number.MAX_SAFE_INTEGER);
  return plans.filter((plan) => plan.needsReorder).sort((a, b) => urgency(a) - urgency(b) || b.perDay - a.perDay || a.name.localeCompare(b.name));
}

/** In stock, and not sold in `deadDays` (or never sold and stocked at least that long ago). The
 *  most money tied up first. */
export function deadStock(plans: PartPlan[], deadDays: number): PartPlan[] {
  return plans
    // A part with no sale and no record of when its stock came in has an unknown age, and is left
    // off rather than guessed at.
    .filter((plan) => plan.onHand > 0 && plan.idleDays !== null && plan.idleDays >= deadDays)
    .sort((a, b) => b.stockValue - a.stockValue || a.name.localeCompare(b.name));
}

export type SupplierDraft = { supplier: string; lines: Array<{ partId: string; label: string; qty: number; unitCost: number }>; total: number };

/** The reorder list split by who supplied each part last, ready to become purchases. */
export function draftsBySupplier(plans: PartPlan[], label: (plan: PartPlan) => string): SupplierDraft[] {
  const drafts = new Map<string, SupplierDraft>();
  for (const plan of plans) {
    const supplier = plan.lastSupplier ?? '';
    const draft = drafts.get(supplier) ?? { supplier, lines: [], total: 0 };
    draft.lines.push({ partId: plan.partId, label: label(plan), qty: plan.suggestQty, unitCost: plan.lastCost });
    draft.total = round2(draft.total + plan.suggestQty * plan.lastCost);
    drafts.set(supplier, draft);
  }
  // Named suppliers first; parts never bought from anyone last.
  return [...drafts.values()].sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || b.total - a.total);
}
