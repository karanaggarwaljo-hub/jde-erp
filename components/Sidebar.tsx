'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ShoppingBag,
  Users,
  Building2,
  Receipt,
  FileText,
  BarChart3,
  Globe,
  Settings,
  LogOut
} from 'lucide-react';
import { logout } from '@/lib/client-auth';

// Grouped by what the person is actually doing, not by how the app is built: the day-to-day
// counter work first, then the two address books, then the money side, then the public site.
// Settings sits apart in the footer — it is administration, not part of anyone's daily loop.
const navGroups = [
  {
    label: 'Operations',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Inventory', href: '/inventory', icon: Package },
      { name: 'Sales', href: '/sales', icon: ShoppingCart },
      { name: 'Purchases', href: '/purchases', icon: ShoppingBag },
    ],
  },
  {
    label: 'Contacts',
    items: [
      { name: 'Customers', href: '/customers', icon: Users },
      { name: 'Suppliers', href: '/suppliers', icon: Building2 },
    ],
  },
  {
    label: 'Finance',
    items: [
      { name: 'Expenses', href: '/expenses', icon: Receipt },
      { name: 'Reports', href: '/reports', icon: FileText },
      { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Online',
    items: [
      { name: 'Website Catalog', href: '/catalog-admin', icon: Globe },
    ],
  },
];

const settingsItem = { name: 'Settings', href: '/settings', icon: Settings };

type SidebarProps = {
  /** Whether the mobile slide-out drawer is open — irrelevant/inert above the 768px breakpoint,
   *  where the sidebar is always visible regardless of this prop. */
  mobileOpen?: boolean;
  /** Called after any navigation (a nav link or Sign Out) so the mobile drawer closes itself
   *  instead of staying open over the newly-loaded page. */
  onNavigate?: () => void;
};

export default function Sidebar({ mobileOpen = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    onNavigate?.();
    await logout();
    router.push('/login');
  };

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  const navLink = ({ name, href, icon: Icon }: { name: string; href: string; icon: typeof Settings }) => (
    <Link
      key={name}
      href={href}
      // Every dashboard destination is dynamic and authenticated. Next's default
      // viewport prefetch turns this persistent sidebar into a burst of server renders
      // (and proxy/auth checks) before the user has asked to visit any of them.
      prefetch={false}
      className={`sidebar-item ${isActive(href) ? 'active' : ''}`}
      onClick={onNavigate}
    >
      <Icon className="sidebar-item-icon" />
      <span>{name}</span>
    </Link>
  );

  return (
    <aside className={`erp-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">JDE</div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">Jai Durga ERP</span>
          <span className="sidebar-logo-tagline">Spare Parts Management</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map(navLink)}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {navLink(settingsItem)}
        <button type="button" onClick={handleSignOut} className="sidebar-item" style={{ color: 'var(--color-danger)', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
          <LogOut className="sidebar-item-icon" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
