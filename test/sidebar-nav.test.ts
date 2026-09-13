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

/** The owner asked why Website Catalog was pinned at the foot of the menu. A pinned row takes room
 *  from the list on a short screen, so it scrolls with the rest now, and only Settings is pinned. */
test('Website Catalog scrolls with the rest of the menu, and only Settings is pinned', () => {
  const inList = navGroups.flatMap((group) => group.items).map((item) => item.name);
  assert.ok(inList.includes('Website Catalog'));
  assert.deepEqual(footerItems.map((item) => item.name), ['Settings']);
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
