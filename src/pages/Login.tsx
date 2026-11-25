import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { appUrl, writeCloudConfig } from '../data/backend';
import type { Backend } from '../data/backend';

type Mode = 'login' | 'signup' | 'reset';

function translate(msg: string): string {
  if (msg === 'Invalid login credentials') return 'Nieprawidłowy e-mail lub hasło.';
  if (msg === 'Email not confirmed') return 'Najpierw potwierdź e-mail — kliknij link w wiadomości od Supabase.';
  if (/Database error saving new user|nie jest na liście/i.test(msg)) return 'Ten e-mail nie jest na liście dostępu. Poproś administratora o dodanie.';
  if (/User already registered/i.test(msg)) return 'Konto już istnieje — zaloguj się albo użyj „Nie pamiętam hasła”.';
  if (/Password should be at least/i.test(msg)) return 'Hasło musi mieć co najmniej 6 znaków.';
  if (/rate limit/i.test(msg)) return 'Zbyt wiele wiadomości e-mail w krótkim czasie. Spróbuj za godzinę albo poproś administratora.';
  return msg;
}

function Frame({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="splash" style={{ background: 'var(--side)' }}>
      <div className="card stack" style={{ width: 'min(400px, 92vw)', textAlign: 'left' }}>
        <div>
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login({ backend }: { backend: Backend }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const auth = backend.client?.auth;
    if (!auth) return;
    setError(null);
    setInfo(null);
    if (mode === 'signup' && password !== password2) return setError('Hasła nie są takie same.');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: err } = await auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(translate(err.message));
      } else if (mode === 'signup') {
        const { data, error: err } = await auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl() } });
        if (err) setError(translate(err.message));
        else if (!data.session) setInfo('Konto utworzone. Sprawdź skrzynkę e-mail i kliknij link potwierdzający, potem zaloguj się.');
      } else {
        const { error: err } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (err) setError(translate(err.message));
        else setInfo('Jeśli konto istnieje, wysłaliśmy link do ustawienia nowego hasła. Otwórz go w tej samej przeglądarce.');
      }
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, [string, string, string]> = {
    login: ['TMT Grafik', 'Zaloguj się, aby zobaczyć grafik i obsadę.', 'Zaloguj'],
    signup: ['Pierwsze logowanie', 'Dla osób dodanych przez administratora. Ustaw swoje hasło.', 'Utwórz konto'],
    reset: ['Nie pamiętam hasła', 'Wyślemy link do ustawienia nowego hasła.', 'Wyślij link'],
  };
  const [title, sub, cta] = titles[mode];

  return (
    <Frame title={title} sub={sub}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          E-mail
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            {mode === 'signup' ? 'Nowe hasło (min. 6 znaków)' : 'Hasło'}
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode === 'signup' && (
          <label className="field">
            Powtórz hasło
            <input type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>
        )}
        {error && <div className="note red" role="alert">{error}</div>}
        {info && <div className="note green" role="status">{info}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Chwileczkę…' : cta}
        </button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {mode !== 'login' ? (
          <button type="button" className="btn ghost small" onClick={() => switchTo('login')}>
            ← Logowanie
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost small" onClick={() => switchTo('signup')}>
              Pierwsze logowanie
            </button>
            <button type="button" className="btn ghost small" onClick={() => switchTo('reset')}>
              Nie pamiętam hasła
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn ghost small"
        style={{ color: 'var(--muted)' }}
        onClick={() => {
          if (!confirm('Odłączyć tę przeglądarkę od zapisanej bazy?')) return;
          writeCloudConfig(null);
          location.reload();
        }}
      >
        Odłącz zapisane połączenie
      </button>
    </Frame>
  );
}

export function SetPassword({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setError('Hasła nie są takie same.');
    const res = await backend.client?.auth.updateUser({ password });
    if (res?.error) setError(translate(res.error.message));
    else onDone();
  };

  return (
    <Frame title="Nowe hasło" sub="Ustaw nowe hasło do TMT Grafik.">
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          Nowe hasło (min. 6 znaków)
          <input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          Powtórz hasło
          <input type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </label>
        {error && <div className="note red" role="alert">{error}</div>}
        <button className="btn primary" type="submit">
          Zapisz hasło
        </button>
      </form>
    </Frame>
  );
}
