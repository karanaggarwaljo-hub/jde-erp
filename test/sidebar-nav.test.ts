import assert from 'node:assert/strict';
import test from 'node:test';
import { footerItems, navGroups } from '../components/sidebar-nav';

const everyItem = [...navGroups.flatMap((group) => group.items), ...footerItems];

/** Tidying the menu must not lose a screen along the way. This is the list it reached before. */
test('the menu still reaches every screen it reached before', () => {
  const before = [
    '/dashboard', '/daybook', '/inventory', '/sales', '/purchases',
    '/customers', '/suppliers', '/expenses', '/reports', '/analytics',
    '/catalog-admin', '/settings',
  ];
  assert.deepEqual(everyItem.map((item) => item.href).sort(), [...before].sort());
});

test('every screen appears in the menu exactly once', () => {
  const hrefs = everyItem.map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

/** A heading, a gap and a divider for one row is most of what made the old menu read as
 *  cluttered — "Online" sat over Website Catalog alone. */
test('no heading sits over a single screen', () => {
  for (const group of navGroups) {
    assert.ok(group.items.length >= 2, `"${group.label}" has only ${group.items.length} screen`);
  }
});

test('every group has a heading', () => {
  for (const group of navGroups) assert.ok(group.label.trim().length > 0);
});

/** On the tablet-width menu the icon is the only label left, so two screens must never look alike.
 *  Sales and Purchases used a shopping cart and a shopping bag, close to the same shape. */
test('no two screens share an icon', () => {
  const icons = everyItem.map((item) => item.icon);
  assert.equal(new Set(icons).size, icons.length);
});

test('daily counter work comes first, in the order it already had', () => {
  assert.deepEqual(
    navGroups[0].items.map((item) => item.name),
    ['Dashboard', 'Day Book', 'Inventory', 'Sales', 'Purchases']
  );
});
