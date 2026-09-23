'use client';

/**
 * Merging a part that was entered twice.
 *
 * The same physical part under two entries splits its stock and its history: one entry shows 20
 * on the shelf and no sales, the other 5 sold and −5 in stock, and neither is true. This starts
 * from the entry clicked, finds the other one, and shows exactly what the single part will be
 * before anything is written. The rules shown come from lib/part-merge.ts; the merge itself is one
 * database transaction (scripts/merge-duplicate-parts.sql).
 */

import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import PartPicker from '@/components/PartPicker';
import PartPhoto from '@/components/PartPhoto';
import { money } from '@/lib/money';
import { planPartMerge, type MergeFill } from '@/lib/part-merge';
import { mergeParts, type MergePartsResult } from '@/lib/client-part-merge';
import type { Product } from '@/lib/inventory-types';

export type MergePartModalProps = {
  duplicate: Product;
  products: Product[];
  companyId: string;
  onClose: () => void;
  onMerged: (result: MergePartsResult, removed: Product) => void;
};

const describe = (p: Product) => (p.part_number ? `${p.part_number} — ${p.name}` : p.name);
const stockOf = (p: Product) => Number(p.current_stock) || 0;
const fillText = (fill: MergeFill) => `${fill.label} ${fill.money ? `₹${money(Number(fill.value))}` : fill.value}`;
const photoLine = { display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' } as const;

export default function MergePartModal({ duplicate, products, companyId, onClose, onMerged }: MergePartModalProps) {
  const [other, setOther] = useState<Product | null>(null);
  // Off: the entry clicked is the duplicate and goes. On: the entry found is the one that goes.
  const [swapped, setSwapped] = useState(false);
  const [chosenNumber, setChosenNumber] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');

  const pickable = useMemo(
    () => products
      .filter((p) => p.id !== duplicate.id)
      .map((p) => ({
        value: describe(p),
        partNumber: p.part_number,
        name: p.name,
        brand: p.brand,
        stock: stockOf(p),
        price: Number(p.sale_price) || 0,
        product: p,
      })),
    [products, duplicate.id],
  );

  const keep = other ? (swapped ? duplicate : other) : null;
  const remove = other ? (swapped ? other : duplicate) : null;
  const plan = keep && remove ? planPartMerge(keep, remove) : null;
  const number = plan ? (chosenNumber ?? plan.defaultNumber) : '';
  const soldBelowZero = keep && remove ? stockOf(keep) < 0 || stockOf(remove) < 0 : false;
  // The photo is shown, not spelled out as an address, so it has its own line.
  const detailFills = plan ? plan.fills.filter((fill) => fill.field !== 'image_url') : [];
  const photoFill = plan?.fills.find((fill) => fill.field === 'image_url');

  const confirm = async () => {
    if (!keep || !remove || merging) return;
    setMerging(true);
    setError('');
    try {
      const result = await mergeParts({
        companyId, keepId: keep.id, removeId: remove.id, partNumber: number, removeLabel: describe(remove),
      });
      onMerged(result, remove);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'These parts could not be merged.');
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true" aria-labelledby="merge-part-title">
        <div className="modal-header"><h3 id="merge-part-title" className="modal-title">Merge a part entered twice</h3></div>
        <div className="modal-body">
          {!keep || !remove || !plan ? (
            <>
              <p style={{ marginBottom: 12 }}>
                Is <strong>{describe(duplicate)}</strong> the same part as another entry? Find that entry:
              </p>
              <PartPicker
                parts={pickable}
                autoFocus
                onPick={(picked) => { setOther(picked.product); setSwapped(false); setChosenNumber(null); setError(''); }}
              />
            </>
          ) : (
            <>
              <p style={{ marginBottom: 10 }}>
                These become one part. <strong>{describe(keep)}</strong> stays; <strong>{describe(remove)}</strong> is removed.
              </p>
              <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={merging}
                  onClick={() => { setSwapped((value) => !value); setChosenNumber(null); }}>
                  <ArrowLeftRight size={14} /> Keep {remove.name} instead
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={merging}
                  onClick={() => { setOther(null); setSwapped(false); setChosenNumber(null); }}>
                  Pick a different part
                </button>
              </div>
              <ul style={{ paddingLeft: 18, display: 'grid', gap: 8, marginBottom: 12 }}>
                <li>
                  Stock becomes <strong>{plan.stockAfter}</strong> ({stockOf(keep)} + {stockOf(remove)}).
                </li>
                <li>Every sale, purchase, return and quotation of {remove.name} shows under {keep.name}.</li>
                {plan.numberChoices.length > 1 ? (
                  <li>
                    Part number to keep:
                    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                      {plan.numberChoices.map((choice) => (
                        <label key={choice} className="flex items-center gap-2" style={{ cursor: merging ? 'default' : 'pointer' }}>
                          <input type="radio" name="merge-part-number" checked={number === choice} disabled={merging}
                            onChange={() => setChosenNumber(choice)} />
                          <span className="pn-chip">{choice}</span>
                        </label>
                      ))}
                    </div>
                  </li>
                ) : plan.numberChoices.length === 1 ? (
                  <li>Part number stays <span className="pn-chip">{plan.numberChoices[0]}</span>.</li>
                ) : null}
                {detailFills.length > 0 && (
                  <li>{keep.name} has no {detailFills.map((fill) => fill.label).join(', ')}, so it takes {remove.name}’s: {detailFills.map(fillText).join(', ')}.</li>
                )}
                {photoFill && (
                  <li>
                    <span style={photoLine}>
                      <PartPhoto url={photoFill.value} name={remove.name} size={40} />
                      <span>{keep.name} has no photo of its own, so it takes {remove.name}’s photo.</span>
                    </span>
                  </li>
                )}
                {plan.droppedPhoto && (
                  <li>
                    <span style={photoLine}>
                      <PartPhoto url={plan.droppedPhoto} name={remove.name} size={40} />
                      <span>{keep.name} keeps its own photo, so {remove.name}’s photo is deleted.</span>
                    </span>
                  </li>
                )}
                {soldBelowZero && (
                  <li>Anything sold while the stock showed below zero takes its cost from the stock that was really on the shelf.</li>
                )}
                <li>The name stays {keep.name}.</li>
              </ul>
              <p className="text-muted" style={{ fontSize: 13 }}>This cannot be undone.</p>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" disabled={merging} onClick={onClose}>Cancel</button>
          {keep && plan && (
            <button className="btn btn-primary" disabled={merging} onClick={confirm}>
              {merging ? 'Merging…' : `Merge into ${keep.name}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
