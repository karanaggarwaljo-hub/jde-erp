'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { logout } from '@/lib/client-auth';
import { footerItems, navGroups, type NavItem } from '@/components/sidebar-nav';

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

  const isActive = (href: string) => pathname === href || Boolean(pathname?.startsWith(href + '/'));

  const navLink = ({ name, href, icon: Icon }: NavItem) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        // Every dashboard destination is dynamic and authenticated. Next's default
        // viewport prefetch turns this persistent sidebar into a burst of server renders
        // (and proxy/auth checks) before the user has asked to visit any of them.
        prefetch={false}
        className={`sidebar-item ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
        // The tablet-width menu shows icons only, so the name has to be reachable on hover there.
        title={name}
        onClick={onNavigate}
      >
        <Icon className="sidebar-item-icon" aria-hidden="true" />
        <span>{name}</span>
      </Link>
    );
  };

  return (
    <aside className={`erp-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">JDE</div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">Jai Durga ERP</span>
          <span className="sidebar-logo-tagline">Spare Parts Management</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        {navGroups.map((group) => (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map(navLink)}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {footerItems.map(navLink)}
        <button type="button" onClick={handleSignOut} className="sidebar-item sidebar-signout" title="Sign Out">
          <LogOut className="sidebar-item-icon" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
