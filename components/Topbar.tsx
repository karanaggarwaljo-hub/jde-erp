'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bell, ChevronDown, Settings, LogOut, Menu, Store, Check } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { logout } from '@/lib/client-auth';
import { ROLE_LABELS, isRole } from '@/lib/authTypes';

type Product = { current_stock: number; min_stock: number };
type Customer = { balance: number };
type Supplier = { balance: number };

// Every screen, by the names the menu uses, with the other words people use for them. Inventory is
// called Stock in the menu, Stock Planning is What to Order, and Analytics is a tab on Reports, so
// the old names are kept as keywords and still find them.
const searchTargets = [
  { label: 'Home', detail: 'Big buttons for the everyday jobs', href: '/dashboard', keywords: 'home dashboard overview start' },
  { label: 'Day Book', detail: 'Everything that happened, day by day', href: '/daybook', keywords: 'day book daybook today cash in out' },
  { label: 'Sales', detail: 'Bills, quotations and returns', href: '/sales', keywords: 'sales bill invoice quotation return credit note customer inv qt' },
  { label: 'Purchases', detail: 'Stock you bought, and supplier bills', href: '/purchases', keywords: 'purchase buy supplier po grn bill' },
  { label: 'Expenses', detail: 'Rent, salary, freight', href: '/expenses', keywords: 'expense rent salary transport freight electricity' },
  { label: 'Stock', detail: 'Parts, prices and how many are on the shelf', href: '/inventory', keywords: 'stock inventory part oem price shelf' },
  { label: 'Customers', detail: 'Who you sell to and who owes you', href: '/customers', keywords: 'customer receivable owe collect dealer garage' },
  { label: 'Suppliers', detail: 'Who you buy from and who you owe', href: '/suppliers', keywords: 'supplier vendor payable owe pay' },
  { label: 'Reports', detail: 'Profit, GST, stock value, AI advice', href: '/reports', keywords: 'report profit loss gst stock value unpaid aging analytics ai advice forecast' },
  { label: 'Job Cards', detail: 'Machines in for repair', href: '/jobs', keywords: 'job card repair machine service workshop mechanic' },
  { label: 'Bills & Invoices', detail: 'Bills given and supplier bills kept', href: '/documents', keywords: 'bill invoice pdf document supplier bill download print' },
  { label: 'Cheques', detail: 'Cheques given and received', href: '/cheques', keywords: 'cheque check bank' },
  { label: 'What to Order', detail: 'A list of parts to buy', href: '/stock-planning', keywords: 'what to order reorder stock planning requirement low' },
  { label: 'Log Book', detail: 'Who did what, and when', href: '/logbook', keywords: 'log book audit history who' },
  { label: 'Website Catalog', detail: 'Your parts on your website', href: '/catalog-admin', keywords: 'website catalog catalogue online publish' },
  { label: 'Settings', detail: 'Company details, people, backups', href: '/settings', keywords: 'settings company users people backup drive' },
];

type TopbarProps = {
  currentUser: { email: string; name: string | null; role: string };
  /** Shows or hides the side menu: the slide-out drawer on a phone, the whole menu column on
   *  anything wider. See DashboardChrome, which owns that state. */
  onMenuClick?: () => void;
};

function initialsFor(name: string | null, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return initials || '?';
}

/**
 * Notifications are useful, but they are not needed to render the top bar. Keeping their data
 * reads inside the popover means opening any ERP page no longer also loads products, customers,
 * suppliers, and catalog leads just to decide whether to show a badge the user may never open.
 */
function NotificationPopover({ onNavigate }: { onNavigate: () => void }) {
  const { rows: products } = useCompanyTable<Product>('products');
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: suppliers } = useCompanyTable<Supplier>('suppliers');
  const { rows: catalogLeads } = useCompanyTable<{ status: string }>('catalog_leads');

  const lowStockCount = products.filter((p) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock)).length;
  const overdueCustomerCount = customers.filter((c) => Number(c.balance) > 0).length;
  const payableSupplierCount = suppliers.filter((s) => Number(s.balance) > 0).length;
  const newLeadsCount = catalogLeads.filter((lead) => lead.status === 'new').length;

  const notifications = [
    ...(lowStockCount > 0 ? [{ href: '/stock-planning', text: `${lowStockCount} ${lowStockCount === 1 ? 'part needs' : 'parts need'} ordering`, tag: 'What to Order' }] : []),
    ...(overdueCustomerCount > 0 ? [{ href: '/customers', text: `${overdueCustomerCount} ${overdueCustomerCount === 1 ? 'customer owes' : 'customers owe'} you money`, tag: 'To collect' }] : []),
    ...(payableSupplierCount > 0 ? [{ href: '/suppliers', text: `You owe ${payableSupplierCount} ${payableSupplierCount === 1 ? 'supplier' : 'suppliers'}`, tag: 'To pay' }] : []),
    ...(newLeadsCount > 0 ? [{ href: '/catalog-admin/leads', text: `${newLeadsCount} new quote ${newLeadsCount === 1 ? 'request' : 'requests'} from your website`, tag: 'Website Catalog' }] : []),
  ];

  return (
    <div className="topbar-popover notification-popover">
      <strong>Notifications</strong>
      {notifications.length === 0 && <p className="popover-empty">Nothing needs attention right now.</p>}
      {notifications.map((notification) => (
        <Link key={notification.href} href={notification.href} prefetch={false} onClick={onNavigate}>
          {notification.text} <small>{notification.tag}</small>
        </Link>
      ))}
    </div>
  );
}

export default function Topbar({ currentUser, onMenuClick }: TopbarProps) {
  const router = useRouter();
  const { companies, activeCompany, switchCompany } = useCompany();
  const topbarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');

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

  const chooseCompany = async (companyId: string) => {
    if (companyId === activeCompany?.id) {
      setProfileOpen(false);
      return;
    }
    setSwitchError('');
    setSwitchingTo(companyId);
    try {
      await switchCompany(companyId);
      setProfileOpen(false);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : 'Could not switch company.');
    } finally {
      setSwitchingTo(null);
    }
  };

  const roleLabel = isRole(currentUser.role) ? ROLE_LABELS[currentUser.role] : currentUser.role;
  // Only an owner can open more than one company. Anyone else sees their company as plain text,
  // with nothing to click that would only be refused.
  const canSwitchCompany = companies.length > 1;

  return (
    <header className="erp-topbar" ref={topbarRef}>
      {/* Shows and hides the side menu, where the company name used to sit — the owner asked for
          the menu button to be here instead. On a phone it opens the drawer, as it always did. */}
      <button className="btn btn-ghost btn-icon nav-toggle" aria-label="Menu" title="Show or hide the menu" onClick={onMenuClick}>
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
                placeholder="Go to a screen: Stock, Sales, Purchases…"
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
        <button className="btn btn-ghost btn-icon" aria-label="Search pages" title="Search pages (Ctrl+K)" onClick={() => setSearchOpen(true)}>
          <Search size={18} />
        </button>

        <div className="topbar-menu-wrap">
          <button className="btn btn-ghost btn-icon" aria-label="Notifications" title="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}>
            <Bell size={18} />
          </button>
          {notificationsOpen && (
            <NotificationPopover onNavigate={() => setNotificationsOpen(false)} />
          )}
        </div>

        <span className="topbar-rule" aria-hidden="true" />

        <div className="topbar-menu-wrap">
          <button className="profile-trigger" aria-label="User menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }}>
            <span className="profile-avatar">{initialsFor(currentUser.name, currentUser.email)}</span>
            <span className="profile-copy"><strong>{currentUser.name || currentUser.email}</strong><small>{roleLabel}</small></span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {profileOpen && (
            <div className="topbar-popover profile-popover">
              {/* The name and role are hidden beside the avatar on a phone, so the menu says them. */}
              <div className="profile-popover-head">
                <strong>{currentUser.name || currentUser.email}</strong>
                <small>{roleLabel}</small>
              </div>

              {/* Which company this screen is showing, and the only way to change it outside
                  Settings. It used to be a chip in the bar itself, where the menu button now is. */}
              {activeCompany && (
                <div className="profile-company" role={canSwitchCompany ? 'group' : undefined} aria-label={canSwitchCompany ? 'Switch company' : undefined}>
                  <span className="profile-company-label">Working in</span>
                  {canSwitchCompany ? (
                    companies.map((company) => {
                      const current = company.id === activeCompany.id;
                      return (
                        <button
                          key={company.id}
                          type="button"
                          className="profile-company-option"
                          role="menuitemradio"
                          aria-checked={current}
                          disabled={switchingTo !== null}
                          onClick={() => chooseCompany(company.id)}
                        >
                          <Store size={15} aria-hidden="true" />
                          <span>{company.name}</span>
                          {switchingTo === company.id ? <small>Switching…</small> : current && <Check size={15} aria-hidden="true" />}
                        </button>
                      );
                    })
                  ) : (
                    <span className="profile-company-current"><Store size={15} aria-hidden="true" />{activeCompany.name}</span>
                  )}
                  {canSwitchCompany && <p className="popover-note">Changes what you see, not what anyone else sees.</p>}
                  {switchError && <p className="popover-error" role="alert">{switchError}</p>}
                </div>
              )}

              <Link href="/settings" prefetch={false} onClick={() => setProfileOpen(false)}><Settings size={15} /> Account settings</Link>
              <button type="button" onClick={handleSignOut}><LogOut size={15} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
