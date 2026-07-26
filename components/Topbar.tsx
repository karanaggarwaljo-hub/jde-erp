'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bell, Sparkles, Sunrise, ChevronDown, Settings, LogOut } from 'lucide-react';

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

export default function Topbar() {
  const router = useRouter();
  const topbarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

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

  return (
    <header className="erp-topbar" ref={topbarRef}>
      <form className="search-bar topbar-search" onSubmit={handleSearch}>
        <Search className="search-bar-icon" size={16} />
        <input
          ref={searchRef}
          aria-label="Universal search"
          type="text"
          placeholder="Universal search (Part #, Customer, Invoice, OEM...)"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
        />
        <span className="keyboard-hint">Ctrl + K</span>
        {searchOpen && (
          <div className="topbar-popover search-results" role="listbox" aria-label="Search results">
            {results.length ? results.map((result) => (
              <button key={result.href} type="button" className="search-result" onClick={() => goToResult(result.href)}>
                <span>{result.label}</span><small>{result.detail}</small>
              </button>
            )) : <p className="popover-empty">No matching ERP section</p>}
          </div>
        )}
      </form>

      <div className="topbar-actions">
        <button className="btn btn-ghost btn-icon" aria-label="Open daily briefing" onClick={() => window.dispatchEvent(new Event('open-daily-briefing'))}>
          <Sunrise size={18} />
        </button>

        <button className="btn btn-secondary btn-sm" style={{ gap: '6px', borderColor: 'rgba(245,158,11,0.3)' }} onClick={() => router.push('/analytics')}>
          <Sparkles size={14} color="var(--brand-primary)" />
          <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>AI Forecast</span>
        </button>

        <div className="topbar-menu-wrap">
          <button className="btn btn-ghost btn-icon" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}>
            <Bell size={18} />
            <span className="sidebar-badge notification-count">3</span>
          </button>
          {notificationsOpen && (
            <div className="topbar-popover notification-popover">
              <strong>Notifications</strong>
              <Link href="/inventory" onClick={() => setNotificationsOpen(false)}>3 critical parts need reordering <small>Inventory</small></Link>
              <Link href="/customers" onClick={() => setNotificationsOpen(false)}>4 customer payments are overdue <small>Receivables</small></Link>
              <Link href="/purchases" onClick={() => setNotificationsOpen(false)}>2 supplier payments are due today <small>Payables</small></Link>
            </div>
          )}
        </div>

        <div className="divider" style={{ height: '24px', margin: 0 }} />

        <div className="topbar-menu-wrap">
          <button className="profile-trigger" aria-label="User menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }}>
            <span className="profile-avatar">KA</span>
            <span className="profile-copy"><strong>Karan Aggarwal</strong><small>Owner / Admin</small></span>
            <ChevronDown size={14} color="var(--text-muted)" />
          </button>
          {profileOpen && (
            <div className="topbar-popover profile-popover">
              <Link href="/settings" onClick={() => setProfileOpen(false)}><Settings size={15} /> Account settings</Link>
              <Link href="/login"><LogOut size={15} /> Sign out</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
