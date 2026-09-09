'use client';

/**
 * The "delete this part?" confirmation, lifted out of app/(dashboard)/inventory/page.tsx.
 *
 * Presentational for the same reason as the other two dialogs on that screen: every value and
 * every setter arrives as a prop, the page still owns the state, and the delete itself still
 * happens on the page. A pure move with no behaviour change.
 */

import type { Product } from '@/lib/inventory-types';

export type DeletePartModalProps = {
  deleteCandidate: Product;
  setDeleteCandidate: (product: Product | null) => void;
  deleteError: string;
  deletingProduct: boolean;
  confirmDelete: () => void;
};

export default function DeletePartModal(props: DeletePartModalProps) {
  const { deleteCandidate, setDeleteCandidate, deleteError, deletingProduct, confirmDelete } = props;

  return (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-part-title">
            <div className="modal-header"><h3 id="delete-part-title" className="modal-title">Delete inventory part?</h3></div>
            <div className="modal-body">
              <p>This will remove <strong>{deleteCandidate.part_number} — {deleteCandidate.name}</strong> from the current inventory list.</p>
              {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" disabled={deletingProduct} onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={deletingProduct} onClick={confirmDelete}>{deletingProduct ? 'Deleting…' : 'Delete Part'}</button>
            </div>
          </div>
        </div>
  );
}
