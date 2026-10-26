import assert from 'node:assert/strict';
import test from 'node:test';
import { footerItems, isCurrentScreen, isMenu, navItems, screensIn } from '../components/sidebar-nav';

const everyScreen = [...screensIn(navItems), ...footerItems];

/** Tidying the menu must not lose a screen along the way. This is the list it reached before. */
test('the menu still reaches every screen it reached before', () => {
  const before = [
    '/dashboard', '/daybook', '/inventory', '/sales', '/purchases',
    '/customers', '/suppliers', '/expenses', '/reports',
    // '/analytics' became the AI Advice tab on Reports, October 2026, at the owner's choice.
    '/catalog-admin', '/settings',
    // Added October 2026: every activity with its time, who and which device.
    '/logbook',
    // '/cash-bank' (Cash & Bank) was added and then removed at the owner's request, October 2026.
    // Added October 2026: reorder list and dead stock.
    '/stock-planning',
    // Added October 2026: every cheque given and received.
    '/cheques',
    // Added October 2026: every invoice issued and supplier bill uploaded.
    '/documents',
    // Added October 2026: machines in for repair.
    '/jobs',
  ];
  assert.deepEqual(everyScreen.map((item) => item.href).sort(), [...before].sort());
});

test('every screen appears in the menu exactly once', () => {
  const hrefs = everyScreen.map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

/** The owner asked for an ERP a school child could use: one short list in plain words, the
 *  everyday screens each a row of their own, and only the occasional ones tucked under More. */
test('the menu is one plain list, in the order of a working day, with More last', () => {
  assert.deepEqual(navItems.map((entry) => entry.name), [
    'Home', 'Day Book', 'Sales', 'Purchases', 'Expenses', 'Stock', 'Customers', 'Suppliers', 'Reports', 'More',
  ]);
  const more = navItems[navItems.length - 1];
  assert.ok(isMenu(more));
  assert.deepEqual(more.items.map((item) => item.name), [
    'Job Cards', 'Bills & Invoices', 'Cheques', 'What to Order', 'Log Book', 'Website Catalog',
  ]);
  assert.equal(navItems.filter(isMenu).length, 1);
});

test('Settings is the only row pinned at the foot of the menu', () => {
  assert.deepEqual(footerItems.map((item) => item.name), ['Settings']);
});

/** On the tablet-width menu the icon is the only label left, so two rows must never look alike.
 *  Sales and Purchases used a shopping cart and a shopping bag, close to the same shape. */
test('no two rows share an icon', () => {
  const menus = navItems.filter(isMenu);
  const icons = [...everyScreen.map((item) => item.icon), ...menus.map((menu) => menu.icon)];
  assert.equal(new Set(icons).size, icons.length);
});

/** More opens by itself on these screens, including a page inside one of them. */
test('a screen is current on its own address and on the pages beneath it, and nowhere else', () => {
  assert.ok(isCurrentScreen('/sales', '/sales'));
  assert.ok(isCurrentScreen('/sales/invoice/INV-1013', '/sales'));
  assert.ok(!isCurrentScreen('/salesman', '/sales'));
  assert.ok(!isCurrentScreen('/daybook', '/sales'));
  assert.ok(!isCurrentScreen(null, '/sales'));
});
