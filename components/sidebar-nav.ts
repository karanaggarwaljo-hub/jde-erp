import type { LucideIcon } from 'lucide-react';
import {
  BookCheck,
  BookOpen,
  ClipboardList,
  Building2,
  Ellipsis,
  FileText,
  Globe,
  House,
  Package,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  FolderOpen,
  Wrench,
} from 'lucide-react';

export type NavItem = { name: string; href: string; icon: LucideIcon };
/** One row that opens to show a few related screens beneath it, instead of a row for each. */
export type NavMenu = { name: string; icon: LucideIcon; items: NavItem[] };
export type NavEntry = NavItem | NavMenu;

export function isMenu(entry: NavEntry): entry is NavMenu {
  return 'items' in entry;
}

/** Every screen a list of entries reaches, with the screens inside a menu counted individually. */
export function screensIn(entries: NavEntry[]): NavItem[] {
  return entries.flatMap((entry) => (isMenu(entry) ? entry.items : [entry]));
}

/** A screen counts as current on its own address and on every page beneath it, such as one invoice. */
export function isCurrentScreen(pathname: string | null, href: string): boolean {
  return pathname === href || Boolean(pathname?.startsWith(href + '/'));
}

/**
 * Every screen the menu reaches, in the order of a working day.
 *
 * The owner found the ERP cluttered and asked for it to be simple enough for a school child. The
 * menu used to have four headings and a Transactions row that had to be opened to reach Sales,
 * Purchases or Expenses. Now it is one short list of plain names with nothing to open, and only
 * the screens used now and then (Job Cards, Bills & Invoices, Cheques, What to Order, Log Book,
 * Website Catalog) wait together under More. More opens by itself whenever one of them is the
 * screen you are on.
 *
 * Inventory is called Stock and Stock Planning is called What to Order, the words used at the
 * counter. The addresses stay as they were, so bookmarks and links in old messages still work.
 * Analytics is no longer a screen of its own: its AI advice is a tab on Reports.
 *
 * Purchases uses a truck rather than a shopping bag. The bag and Sales' shopping cart were close to
 * the same shape at this size, and the icon is the only label left on the narrow tablet menu.
 */
export const navItems: NavEntry[] = [
  { name: 'Home', href: '/dashboard', icon: House },
  { name: 'Day Book', href: '/daybook', icon: BookOpen },
  { name: 'Sales', href: '/sales', icon: ShoppingCart },
  { name: 'Purchases', href: '/purchases', icon: Truck },
  { name: 'Expenses', href: '/expenses', icon: Wallet },
  { name: 'Stock', href: '/inventory', icon: Package },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Suppliers', href: '/suppliers', icon: Building2 },
  { name: 'Reports', href: '/reports', icon: FileText },
  {
    name: 'More',
    icon: Ellipsis,
    items: [
      // Machines in for repair, whose parts are billed once when the job is done.
      { name: 'Job Cards', href: '/jobs', icon: Wrench },
      { name: 'Bills & Invoices', href: '/documents', icon: FolderOpen },
      { name: 'Cheques', href: '/cheques', icon: BookCheck },
      { name: 'What to Order', href: '/stock-planning', icon: ClipboardList },
      { name: 'Log Book', href: '/logbook', icon: ScrollText },
      { name: 'Website Catalog', href: '/catalog-admin', icon: Globe },
    ],
  },
];

/** Pinned below the divider at the foot of the menu, with Sign Out. */
export const footerItems: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
];
