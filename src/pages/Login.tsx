import { useState } from 'react';
import type { FormEvent } from 'react';
import { writeCloudConfig } from '../data/backend';
import type { Backend } from '../data/backend';

export default function Login({ backend }: { backend: Backend }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend.client) return;
    setBusy(true);
    setError(null);
    const { error: err } = await backend.client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Nieprawidłowy e-mail lub hasło.' : err.message);
  };

  return (
    <div className="splash" style={{ background: 'var(--side)' }}>
      <form className="card stack" style={{ width: 'min(380px, 92vw)', textAlign: 'left' }} onSubmit={(e) => void submit(e)}>
        <div>
          <h1>TMT Grafik</h1>
          <div className="sub">Zaloguj się, aby zobaczyć grafik i obsadę.</div>
        </div>
        <label className="field">
          E-mail
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Hasło
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="note red" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Logowanie…' : 'Zaloguj'}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            if (!confirm('Odłączyć tę przeglądarkę od bazy i wrócić do trybu demo?')) return;
            writeCloudConfig(null);
            location.reload();
          }}
        >
          Odłącz zapisane połączenie
        </button>
      </form>
    </div>
  );
}
