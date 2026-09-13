'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, LogOut } from 'lucide-react';
import { logout } from '@/lib/client-auth';
import {
  footerItems,
  isCurrentScreen,
  isMenu,
  navGroups,
  type NavItem,
  type NavMenu,
} from '@/components/sidebar-nav';

type SidebarProps = {
  /** Whether the mobile slide-out drawer is open — irrelevant/inert above the 768px breakpoint,
   *  where the sidebar is always visible regardless of this prop. */
  mobileOpen?: boolean;
  /** Called after any navigation (a nav link or Sign Out) so the mobile drawer closes itself
   *  instead of staying open over the newly-loaded page. */
  onNavigate?: () => void;
};

type NavLinkProps = NavItem & { pathname: string | null; onNavigate?: () => void; inMenu?: boolean };

function NavLink({ name, href, icon: Icon, pathname, onNavigate, inMenu = false }: NavLinkProps) {
  const active = isCurrentScreen(pathname, href);
  return (
    <Link
      href={href}
      // Every dashboard destination is dynamic and authenticated. Next's default
      // viewport prefetch turns this persistent sidebar into a burst of server renders
      // (and proxy/auth checks) before the user has asked to visit any of them.
      prefetch={false}
      className={`sidebar-item ${inMenu ? 'sidebar-subitem' : ''} ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      // The tablet-width menu shows icons only, so the name has to be reachable on hover there.
      title={name}
      onClick={onNavigate}
    >
      <Icon className="sidebar-item-icon" aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

/**
 * A row that opens to show its screens beneath it. It opens by itself whenever you arrive on one of
 * them, so the highlighted screen is never hidden inside a closed row, and otherwise stays the way you
 * last left it. Closed while holding the current screen, the row itself takes the highlight.
 */
function NavMenuRow({ menu, pathname, onNavigate }: { menu: NavMenu; pathname: string | null; onNavigate?: () => void }) {
  const holdsCurrent = menu.items.some((item) => isCurrentScreen(pathname, item.href));
  const [open, setOpen] = useState(holdsCurrent);
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (seenPathname !== pathname) {
    setSeenPathname(pathname);
    if (holdsCurrent && !open) setOpen(true);
  }
  const listId = useId();
  const Icon = menu.icon;

  return (
    <>
      <button
        type="button"
        className={`sidebar-item sidebar-menu-toggle ${open ? 'open' : ''} ${holdsCurrent && !open ? 'active' : ''}`}
        aria-expanded={open}
        aria-controls={listId}
        title={`${menu.name}: ${menu.items.map((item) => item.name).join(', ')}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon className="sidebar-item-icon" aria-hidden="true" />
        <span>{menu.name}</span>
        <ChevronRight className="sidebar-menu-chevron" aria-hidden="true" />
      </button>
      <div id={listId} className="sidebar-submenu" role="group" aria-label={menu.name} hidden={!open}>
        {menu.items.map((item) => (
          <NavLink key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} inMenu />
        ))}
      </div>
    </>
  );
}

export default function Sidebar({ mobileOpen = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    onNavigate?.();
    await logout();
    router.push('/login');
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
            {group.items.map((entry) =>
              isMenu(entry) ? (
                <NavMenuRow key={entry.name} menu={entry} pathname={pathname} onNavigate={onNavigate} />
              ) : (
                <NavLink key={entry.href} {...entry} pathname={pathname} onNavigate={onNavigate} />
              )
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {footerItems.map((item) => (
          <NavLink key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} />
        ))}
        <button type="button" onClick={handleSignOut} className="sidebar-item sidebar-signout" title="Sign Out">
          <LogOut className="sidebar-item-icon" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
