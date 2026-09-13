import assert from 'node:assert/strict';
import test from 'node:test';
import { footerItems, isCurrentScreen, isMenu, navGroups, screensIn } from '../components/sidebar-nav';

const everyScreen = [...navGroups.flatMap((group) => screensIn(group.items)), ...footerItems];

/** Tidying the menu must not lose a screen along the way. This is the list it reached before. */
test('the menu still reaches every screen it reached before', () => {
  const before = [
    '/dashboard', '/daybook', '/inventory', '/sales', '/purchases',
    '/customers', '/suppliers', '/expenses', '/reports', '/analytics',
    '/catalog-admin', '/settings',
  ];
  assert.deepEqual(everyScreen.map((item) => item.href).sort(), [...before].sort());
});

test('every screen appears in the menu exactly once', () => {
  const hrefs = everyScreen.map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

/** The owner asked why Website Catalog was pinned at the foot of the menu. A pinned row takes room
 *  from the list on a short screen, so it scrolls with the rest now, and only Settings is pinned. */
test('Website Catalog scrolls with the rest of the menu, and only Settings is pinned', () => {
  const inList = navGroups.flatMap((group) => screensIn(group.items)).map((item) => item.name);
  assert.ok(inList.includes('Website Catalog'));
  assert.deepEqual(footerItems.map((item) => item.name), ['Settings']);
});

test('every group has a heading', () => {
  for (const group of navGroups) assert.ok(group.label.trim().length > 0);
});

/** On the tablet-width menu the icon is the only label left, so two rows must never look alike.
 *  Sales and Purchases used a shopping cart and a shopping bag, close to the same shape. */
test('no two rows share an icon', () => {
  const menus = navGroups.flatMap((group) => group.items).filter(isMenu);
  const icons = [...everyScreen.map((item) => item.icon), ...menus.map((menu) => menu.icon)];
  assert.equal(new Set(icons).size, icons.length);
});

/** The Day Book starts sales, purchases and expenses itself, so the owner asked for the three rows
 *  to become one that opens to show them. */
test('Sales, Purchases and Expenses share one Transactions row, after the rest of daily work', () => {
  const daily = navGroups[0].items;
  assert.deepEqual(daily.map((entry) => entry.name), ['Dashboard', 'Day Book', 'Inventory', 'Transactions']);
  const transactions = daily[3];
  assert.ok(isMenu(transactions));
  assert.deepEqual(transactions.items.map((item) => item.name), ['Sales', 'Purchases', 'Expenses']);
  const menus = navGroups.flatMap((group) => group.items).filter(isMenu);
  assert.equal(menus.length, 1);
});

/** The Transactions row opens by itself on these screens, including a page inside one of them. */
test('a screen is current on its own address and on the pages beneath it, and nowhere else', () => {
  assert.ok(isCurrentScreen('/sales', '/sales'));
  assert.ok(isCurrentScreen('/sales/invoice/INV-1013', '/sales'));
  assert.ok(!isCurrentScreen('/salesman', '/sales'));
  assert.ok(!isCurrentScreen('/daybook', '/sales'));
  assert.ok(!isCurrentScreen(null, '/sales'));
});
