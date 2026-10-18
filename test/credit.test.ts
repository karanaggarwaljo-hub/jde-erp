import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBillCredit, creditState, reminderText, whatsappLink, whatsappNumber } from '../lib/credit';

test('no limit set means no limit — nothing changes for anyone by default', () => {
  const state = creditState(50000, 0);
  assert.equal(state.limit, null);
  assert.equal(state.over, false);
  assert.equal(creditState(50000, null).over, false);
});

test('a limit: how much is used, how much room, and how far over', () => {
  assert.deepEqual(creditState(15000, 20000), { limit: 20000, balance: 15000, usedPercent: 75, over: false, overBy: 0, room: 5000 });
  const over = creditState(23500, 20000);
  assert.equal(over.over, true);
  assert.equal(over.overBy, 3500);
  assert.equal(over.room, 0);
});

test('a new bill that takes the customer over their limit is flagged', () => {
  const check = checkBillCredit({ balance: 15000, limit: 20000, oldBillDue: 0, newBillDue: 8000 });
  assert.equal(check.after, 23000);
  assert.equal(check.over, true);
  assert.equal(check.overBy, 3000);
  assert.equal(check.blocksQuietSave, true);
});

test('editing a bill counts only the change, and lowering what is owed never asks', () => {
  // The edited bill already had ₹8,000 on the account; it now leaves ₹6,000.
  const lowered = checkBillCredit({ balance: 23000, limit: 20000, oldBillDue: 8000, newBillDue: 6000 });
  assert.equal(lowered.after, 21000);
  assert.equal(lowered.over, true);
  assert.equal(lowered.blocksQuietSave, false, 'it reduces what is owed');
  const paid = checkBillCredit({ balance: 15000, limit: 20000, oldBillDue: 0, newBillDue: 0 });
  assert.equal(paid.over, false);
});

test('phone numbers become WhatsApp numbers, or nothing', () => {
  assert.equal(whatsappNumber('94173 92417'), '919417392417');
  assert.equal(whatsappNumber('+91-94173-92417'), '919417392417');
  assert.equal(whatsappNumber('09417392417'), '919417392417');
  assert.equal(whatsappNumber('0172-2345678'), null, 'a landline cannot get WhatsApp');
  assert.equal(whatsappNumber(''), null);
  assert.equal(whatsappLink(null, 'hi'), null);
  assert.ok(whatsappLink('9417392417', 'a b')!.startsWith('https://wa.me/919417392417?text=a%20b'));
});

test('the reminder lists the open bills, oldest first, with the total', () => {
  const text = reminderText({
    shopName: 'M/S Jai Durga Enterprises', customerName: 'Bawa', total: 7502.62, shopPhone: '9417392417',
    bills: [{ id: 'INV-1031', date: '2026-10-12', due: 2500 }, { id: 'INV-1005', date: '2026-08-21', due: 5002.62 }],
  });
  assert.ok(text.startsWith('Namaste Bawa,'));
  assert.ok(text.includes('*₹7,502.62*'));
  assert.ok(text.indexOf('INV-1005') < text.indexOf('INV-1031'), 'oldest first');
  assert.ok(text.endsWith('9417392417'));
});
