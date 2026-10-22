import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDispatch, dispatchOf, hasDispatch, EMPTY_DISPATCH } from '../lib/invoice-dispatch';
import { buildTallyInvoice } from '../lib/tally-invoice';

/** The owner asked how to fill in Disp Through, Terms of Delivery, Destination, Other Reference and
 *  E-Way Bill No. on the invoice: they are typed on the bill and printed beside its number. */
test('dispatch details typed on the bill print beside the invoice number, blanks stay blank', () => {
  const doc = buildTallyInvoice({
    invoice: { id: 'INV-1019', date: '2026-10-22', customer: 'Walk-in Customer', total: 100, paid: 0, mode: 'credit', dispatched_through: 'By road, HP03 A 1234', destination: 'Shimla', eway_bill_no: '1234 5678 9012' },
    items: [], company: { name: 'bkgkj' }, customer: null,
  });
  assert.deepEqual(doc.details.slice(3), [
    ['Disp Through', 'By road, HP03 A 1234'], ['Terms of Delivery', ''], ['Destination', 'Shimla'], ['Other Reference', ''], ['E-Way Bill No.', '1234 5678 9012'],
  ]);
});

test('what is stored is trimmed and cut to size, an empty box is stored as nothing, and nothing sent changes nothing', () => {
  const row = cleanDispatch({ dispatched_through: '  By   road ', destination: '', eway_bill_no: '9'.repeat(60), other_reference: 42 });
  assert.equal(row?.dispatched_through, 'By road');
  assert.equal(row?.destination, null);
  assert.equal(row?.other_reference, null);
  assert.equal(row?.eway_bill_no?.length, 40);
  assert.equal(cleanDispatch(undefined), null);
  assert.deepEqual(dispatchOf({ destination: 'Shimla', eway_bill_no: null }), { ...EMPTY_DISPATCH, destination: 'Shimla' });
  assert.equal(hasDispatch(EMPTY_DISPATCH), false);
  assert.equal(hasDispatch({ ...EMPTY_DISPATCH, destination: 'Shimla' }), true);
});
