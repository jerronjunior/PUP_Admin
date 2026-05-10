// src/pages/LoginPage.js
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async e => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError('Invalid email or password. Only admins can log in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.bg}>
      <form onSubmit={submit} style={s.card} autoComplete="new-password">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>♻️</div>
          <h1 style={s.title}>RecycleScan Admin</h1>
          <p style={s.sub}>Admin access only</p>
        </div>

        {error && <div style={s.err}>{error}</div>}

        <label style={s.label}>Email address</label>
        <input style={s.input} type="email" required autoFocus
          name="adminLoginEmail"
          autoComplete="new-password"
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Enter email" />

        <label style={s.label}>Password</label>
        <input style={s.input} type="password" required
          name="adminLoginPassword"
          autoComplete="new-password"
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Enter password" />

        <button style={{ ...s.btn, opacity: loading ? .7 : 1 }}
          type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in →'}
        </button>
      </form>
    </div>
  );
}

const s = {
  bg:    { minHeight: '100vh', background: 'linear-gradient(135deg,#1B5E20,#2E7D32)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,system-ui,sans-serif' },
  card:  { background: '#fff', borderRadius: 20, padding: '40px 36px', width: 380, boxShadow: '0 20px 60px rgba(0,0,0,.25)' },
  title: { margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#1B5E20' },
  sub:   { margin: 0, color: '#888', fontSize: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#555', margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: .5 },
  input: { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #ddd', fontSize: 14, marginBottom: 18, boxSizing: 'border-box', outline: 'none', transition: 'border .15s' },
  btn:   { width: '100%', padding: '13px', background: 'linear-gradient(135deg,#2E7D32,#388E3C)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: .3 },
  err:   { background: '#FFEBEE', color: '#C62828', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 18, fontWeight: 500 },
};
