'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ShieldCheck } from 'lucide-react';
import { login } from '@/lib/client-auth';

export default function LoginForm({ initialError }: { initialError: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: 'var(--ink)', marginBottom: '12px', boxShadow: 'var(--shadow-sm)' }}>
            JDE
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Jai Durga ERP</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Spare Parts Cloud Management & AI Analytics</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {error && <p className="form-error">{error}</p>}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="search-bar">
              <Mail size={16} className="search-bar-icon" />
              <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="search-bar">
              <Lock size={16} className="search-bar-icon" />
              <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg w-full mt-2" style={{ justifyContent: 'center' }} disabled={submitting}>
            <ShieldCheck size={18} /> {submitting ? 'Signing in…' : 'Sign In to ERP System'}
          </button>

          <Link href="/forgot-password" style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--text-muted)' }}>Forgot password?</Link>
        </form>
      </div>
    </div>
  );
}
