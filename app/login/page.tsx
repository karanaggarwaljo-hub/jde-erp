'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, Sparkles, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('karan@jaidurga.com');
  const [password, setPassword] = useState('password123');
  const [role, setRole] = useState('owner');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    router.push('/dashboard');
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: '#000', marginBottom: '12px', boxShadow: 'var(--shadow-glow)' }}>
            JDE
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Jai Durga ERP</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Spare Parts Cloud Management & AI Analytics</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Role Access Mode</label>
            <select className="form-input form-select" value={role} onChange={e => setRole(e.target.value)}>
              <option value="owner">Owner / Admin</option>
              <option value="manager">Store Manager</option>
              <option value="salesman">Salesman</option>
              <option value="accountant">Accountant</option>
              <option value="warehouse">Warehouse Staff</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="search-bar">
              <Mail size={16} className="search-bar-icon" />
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="search-bar">
              <Lock size={16} className="search-bar-icon" />
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg w-full mt-2" style={{ justifyContent: 'center' }}>
            <ShieldCheck size={18} /> Sign In to ERP System
          </button>
        </form>
      </div>
    </div>
  );
}
