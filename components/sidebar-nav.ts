import type { LucideIcon } from 'lucide-react';
import {
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
export type NavGroup = { label: string; items: NavItem[] };

/**
 * Every screen the menu reaches, and how it is grouped.
 *
 * Daily counter work comes first, in the order it already had, so nobody has to relearn where Sales
 * is. Website Catalog is the last group in the list and scrolls with everything else. For a while it
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
      { name: 'Sales', href: '/sales', icon: ShoppingCart },
      { name: 'Purchases', href: '/purchases', icon: Truck },
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
      { name: 'Expenses', href: '/expenses', icon: Wallet },
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
