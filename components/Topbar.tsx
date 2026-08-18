'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bell, ChevronDown, Settings, LogOut, Menu } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { logout } from '@/lib/client-auth';
import { ROLE_LABELS, isRole } from '@/lib/authTypes';

type Product = { current_stock: number; min_stock: number };
type Customer = { balance: number };
type Supplier = { balance: number };

const searchTargets = [
  { label: 'Dashboard', detail: 'Executive overview', href: '/dashboard', keywords: 'dashboard overview performance' },
  { label: 'Inventory', detail: 'Parts, OEM numbers and stock', href: '/inventory', keywords: 'inventory part oem stock sp-001 sp-006' },
  { label: 'Sales', detail: 'Invoices, quotations and returns', href: '/sales', keywords: 'sales invoice quotation customer inv qt' },
  { label: 'Purchases', detail: 'Purchase orders and GRNs', href: '/purchases', keywords: 'purchase supplier po grn procurement' },
  { label: 'Customers', detail: 'Customer accounts and receivables', href: '/customers', keywords: 'customer receivable dealer garage' },
  { label: 'Suppliers', detail: 'Vendors and payables', href: '/suppliers', keywords: 'supplier vendor payable' },
  { label: 'Expenses', detail: 'Operating costs', href: '/expenses', keywords: 'expense rent salary transport utilities' },
  { label: 'Reports', detail: 'Financial and operational reports', href: '/reports', keywords: 'report profit loss gst stock valuation' },
  { label: 'Analytics', detail: 'Demand forecast and trends', href: '/analytics', keywords: 'analytics ai forecast demand' },
];

type TopbarProps = {
  currentUser: { email: string; name: string | null; role: string };
  /** Toggles the mobile slide-out sidebar. The button that calls this is only visible below
   *  the 768px breakpoint (see .mobile-menu-btn in globals.css) — above it the sidebar is
   *  always on screen and there's nothing for this button to do. */
  onMenuClick?: () => void;
};

function initialsFor(name: string | null, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return initials || '?';
}

export default function Topbar({ currentUser, onMenuClick }: TopbarProps) {
  const router = useRouter();
  const topbarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const { rows: products } = useCompanyTable<Product>('products');
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: suppliers } = useCompanyTable<Supplier>('suppliers');
  const { rows: catalogLeads } = useCompanyTable<{ status: string }>('catalog_leads');

  const lowStockCount = products.filter((p) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock)).length;
  const overdueCustomerCount = customers.filter((c) => Number(c.balance) > 0).length;
  const payableSupplierCount = suppliers.filter((s) => Number(s.balance) > 0).length;
  const newLeadsCount = catalogLeads.filter((l) => l.status === 'new').length;

  const notifications = [
    ...(lowStockCount > 0 ? [{ href: '/inventory', text: `${lowStockCount} part(s) need reordering`, tag: 'Inventory' }] : []),
    ...(overdueCustomerCount > 0 ? [{ href: '/customers', text: `${overdueCustomerCount} customer payment(s) outstanding`, tag: 'Receivables' }] : []),
    ...(payableSupplierCount > 0 ? [{ href: '/purchases', text: `${payableSupplierCount} supplier payment(s) outstanding`, tag: 'Payables' }] : []),
    ...(newLeadsCount > 0 ? [{ href: '/catalog-admin/leads', text: `${newLeadsCount} new catalog quote request(s)`, tag: 'Website Catalog' }] : []),
  ];

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return searchTargets.slice(0, 5);
    return searchTargets.filter((target) => `${target.label} ${target.detail} ${target.keywords}`.toLowerCase().includes(normalized));
  }, [query]);

  const goToResult = (href: string) => {
    router.push(href);
    setQuery('');
    setSearchOpen(false);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    if (results[0]) goToResult(results[0].href);
  };

  const handleSignOut = async () => {
    await logout();
    router.push('/login');
  };

  const roleLabel = isRole(currentUser.role) ? ROLE_LABELS[currentUser.role] : currentUser.role;

  return (
    <header className="erp-topbar" ref={topbarRef}>
      <button className="btn btn-ghost btn-icon mobile-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <Menu size={20} />
      </button>

      {searchOpen && (
        <div className="search-overlay" onClick={() => { setSearchOpen(false); setQuery(''); }}>
          <div className="search-overlay-box" onClick={(event) => event.stopPropagation()}>
            <form className="search-overlay-input-wrap" onSubmit={handleSearch}>
              <Search className="search-bar-icon" size={16} />
              <input
                ref={searchRef}
                aria-label="Universal search"
                type="text"
                placeholder="Search app pages — Inventory, Sales, Purchases..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="keyboard-hint">Esc</span>
            </form>
            <div className="search-overlay-results" role="listbox" aria-label="Search results">
              {results.length ? results.map((result) => (
                <button key={result.href} type="button" className="search-result" onClick={() => goToResult(result.href)}>
                  <span>{result.label}</span><small>{result.detail}</small>
                </button>
              )) : <p className="popover-empty">No matching ERP section</p>}
            </div>
            <div className="search-overlay-hint">Ctrl + K to search from anywhere</div>
          </div>
        </div>
      )}

      <div className="topbar-actions">
        <button className="btn btn-ghost btn-icon" aria-label="Search everything" onClick={() => setSearchOpen(true)}>
          <Search size={18} />
        </button>

        <div className="topbar-menu-wrap">
          <button className="btn btn-ghost btn-icon" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}>
            <Bell size={18} />
            {notifications.length > 0 && <span className="sidebar-badge notification-count">{notifications.length}</span>}
          </button>
          {notificationsOpen && (
            <div className="topbar-popover notification-popover">
              <strong>Notifications</strong>
              {notifications.length === 0 && <p className="popover-empty">Nothing needs attention right now.</p>}
              {notifications.map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setNotificationsOpen(false)}>{n.text} <small>{n.tag}</small></Link>
              ))}
            </div>
          )}
        </div>

        <div className="divider" style={{ height: '24px', margin: 0 }} />

        <div className="topbar-menu-wrap">
          <button className="profile-trigger" aria-label="User menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }}>
            <span className="profile-avatar">{initialsFor(currentUser.name, currentUser.email)}</span>
            <span className="profile-copy"><strong>{currentUser.name || currentUser.email}</strong><small>{roleLabel}</small></span>
            <ChevronDown size={14} color="var(--text-muted)" />
          </button>
          {profileOpen && (
            <div className="topbar-popover profile-popover">
              <Link href="/settings" onClick={() => setProfileOpen(false)}><Settings size={15} /> Account settings</Link>
              <button type="button" onClick={handleSignOut}><LogOut size={15} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
