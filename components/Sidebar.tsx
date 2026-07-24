'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  Settings,
  Bell,
  Search,
  Sparkles,
  LogOut
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Inventory', href: '/inventory', icon: Package, badge: 'Low Stock' },
  { name: 'Sales', href: '/sales', icon: ShoppingCart },
  { name: 'Purchases', href: '/purchases', icon: ShoppingBag },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Suppliers', href: '/suppliers', icon: Building2 },
  { name: 'Expenses', href: '/expenses', icon: Receipt },
  { name: 'Reports', href: '/reports', icon: FileText },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="erp-sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">JDE</div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">Jai Durga ERP</span>
          <span className="sidebar-logo-tagline">Spare Parts Management</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Main Menu</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className="sidebar-item-icon" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-item" style={{ color: '#EF4444' }}>
          <LogOut className="sidebar-item-icon" />
          <span>Sign Out</span>
        </div>
      </div>
    </aside>
  );
}
