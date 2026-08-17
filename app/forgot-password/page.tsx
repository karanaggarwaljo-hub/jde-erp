'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ShieldCheck } from 'lucide-react';
import { forgotPassword } from '@/lib/client-auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await forgotPassword(email);
    setSent(true);
    setSubmitting(false);
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #F59E0B, #F97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: '#000', marginBottom: '12px', boxShadow: 'var(--shadow-glow)' }}>
            JDE
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Reset Password</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Enter your account email and we&apos;ll send a link to set a new password.</p>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <div className="alert alert-success" role="status">If that email has an account, a reset link is on its way — check your inbox (and spam folder).</div>
            <Link href="/login" className="btn btn-secondary btn-lg w-full" style={{ justifyContent: 'center' }}>Back to Sign In</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div className="search-bar">
                <Mail size={16} className="search-bar-icon" />
                <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg w-full mt-2" style={{ justifyContent: 'center' }} disabled={submitting}>
              <ShieldCheck size={18} /> {submitting ? 'Sending…' : 'Send Reset Link'}
            </button>
            <Link href="/login" style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--text-muted)' }}>Back to Sign In</Link>
          </form>
        )}
      </div>
    </div>
  );
}
