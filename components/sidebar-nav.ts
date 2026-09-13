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
 * Three groups, no heading over a single screen. The menu used to carry four headings, one of them
 * ("Online") sitting over Website Catalog alone, which is most of why it read as cluttered: a
 * heading, a gap and a divider for one row.
 *
 * Daily counter work comes first, in the order it already had, so nobody has to relearn where Sales
 * is. Website Catalog moves down beside Settings: it is setting up what the public website shows,
 * something done now and then, not part of the day.
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
];

/** Setup rather than daily work, kept below the divider at the foot of the menu. */
export const footerItems: NavItem[] = [
  { name: 'Website Catalog', href: '/catalog-admin', icon: Globe },
  { name: 'Settings', href: '/settings', icon: Settings },
];
