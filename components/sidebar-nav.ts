import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  Globe,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

export type NavItem = { name: string; href: string; icon: LucideIcon };
/** One row that opens to show a few related screens beneath it, instead of a row for each. */
export type NavMenu = { name: string; icon: LucideIcon; items: NavItem[] };
export type NavEntry = NavItem | NavMenu;
export type NavGroup = { label: string; items: NavEntry[] };

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
 * Every screen the menu reaches, and how it is grouped.
 *
 * Sales, Purchases and Expenses share one row, Transactions, that opens to show all three. The Day
 * Book's Record buttons now start a sale, a purchase or an expense directly, so three separate rows
 * for them had become clutter, and the owner asked for them to be merged. The row opens by itself
 * whenever one of the three is the screen you are on.
 *
 * Website Catalog is the last group in the list and scrolls with everything else. For a while it
 * was pinned at the foot of the menu beside Settings, and the owner asked why: a pinned row takes
 * room away from the list on a short screen, and it read as stuck there. Only Settings stays pinned,
 * above Sign Out.
 *
 * Purchases uses a truck rather than a shopping bag. The bag and Sales' shopping cart were close to
 * the same shape at this size, and the icon is the only label left on the narrow tablet menu.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Daily work',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Day Book', href: '/daybook', icon: BookOpen },
      { name: 'Inventory', href: '/inventory', icon: Package },
      {
        name: 'Transactions',
        icon: ArrowLeftRight,
        items: [
          { name: 'Sales', href: '/sales', icon: ShoppingCart },
          { name: 'Purchases', href: '/purchases', icon: Truck },
          { name: 'Expenses', href: '/expenses', icon: Wallet },
        ],
      },
    ],
  },
  {
    label: 'Customers & suppliers',
    items: [
      { name: 'Customers', href: '/customers', icon: Users },
      { name: 'Suppliers', href: '/suppliers', icon: Building2 },
    ],
  },
  {
    label: 'Money & reports',
    items: [
      { name: 'Reports', href: '/reports', icon: FileText },
      { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Website',
    items: [
      { name: 'Website Catalog', href: '/catalog-admin', icon: Globe },
    ],
  },
];

/** Pinned below the divider at the foot of the menu, with Sign Out. */
export const footerItems: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
];
