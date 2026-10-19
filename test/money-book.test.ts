import assert from 'node:assert/strict';
import test from 'node:test';
import { methodFromText } from '../lib/money-book';

test('free-text payment modes are read as methods where they can be', () => {
  assert.equal(methodFromText('Cheque no 4471'), 'cheque');
  assert.equal(methodFromText('GPay'), 'upi');
  assert.equal(methodFromText('bank_transfer'), 'bank');
  assert.equal(methodFromText('NEFT'), 'bank');
  assert.equal(methodFromText('cash'), 'cash');
  assert.equal(methodFromText('given to Ramesh'), null);
  assert.equal(methodFromText(''), null);
});
