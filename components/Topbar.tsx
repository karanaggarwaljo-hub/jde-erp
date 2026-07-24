'use client';

import { useState } from 'react';
import { Search, Bell, Sparkles, User, ChevronDown } from 'lucide-react';

export default function Topbar() {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <header className="erp-topbar">
      {/* Universal Search Bar */}
      <div className="search-bar" style={{ width: '360px' }}>
        <Search className="search-bar-icon" size={16} />
        <input
          type="text"
          placeholder="Universal search (Part #, Customer, Invoice, OEM...)"
        />
        <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
          Ctrl + K
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* AI Assistant Quick Trigger */}
        <button className="btn btn-secondary btn-sm" style={{ gap: '6px', borderColor: 'rgba(245,158,11,0.3)' }}>
          <Sparkles size={14} color="var(--brand-primary)" />
          <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>AI Forecast</span>
        </button>

        {/* Notifications Icon */}
        <button className="btn btn-ghost btn-icon" style={{ position: 'relative' }}>
          <Bell size={18} />
          <span className="sidebar-badge" style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '9px', padding: '0 4px' }}>
            3
          </span>
        </button>

        <div className="divider" style={{ height: '24px', margin: 0 }} />

        {/* User Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#000', fontSize: '13px' }}>
            KA
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              Karan Aggarwal
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Owner / Admin
            </span>
          </div>
          <ChevronDown size={14} color="var(--text-muted)" />
        </div>
      </div>
    </header>
  );
}
