import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { appUrl, writeCloudConfig } from '../data/backend';
import { LangSwitch, ThemeSwitch } from '../ui';
import type { Backend } from '../data/backend';
import { t } from '../i18n';

type Mode = 'login' | 'signup' | 'reset';

function translate(msg: string): string {
  if (msg === 'Invalid login credentials') return t('Nieprawidłowy e-mail lub hasło.');
  if (msg === 'Email not confirmed') return t('Najpierw potwierdź e-mail — kliknij link w wiadomości od Supabase.');
  if (/Database error saving new user|nie jest na liście|kod aktywacyjny/i.test(msg)) return t('E-mail nie jest na liście albo kod aktywacyjny jest nieprawidłowy lub wygasł. Poproś przełożonego o nowy kod.');
  if (/sending confirmation|not authorized/i.test(msg)) return t('Serwer próbuje wysłać e-mail potwierdzający. Administrator musi wyłączyć „Confirm email” w Supabase (Authentication → Sign In / Providers → Email).');
  if (/User already registered/i.test(msg)) return t('Konto już istnieje — zaloguj się albo użyj „Nie pamiętam hasła”.');
  if (/Password should be at least/i.test(msg)) return t('Hasło musi mieć co najmniej 6 znaków.');
  if (/rate limit/i.test(msg)) return t('Zbyt wiele wiadomości e-mail w krótkim czasie. Spróbuj za godzinę albo poproś administratora.');
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
        <LangSwitch />
        <ThemeSwitch />
        {children}
      </div>
    </div>
  );
}

export default function Login({ backend }: { backend: Backend }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>(params.get('kod') ? 'signup' : 'login');
  const [email, setEmail] = useState(params.get('e') ?? '');
  const [code, setCode] = useState(params.get('kod') ?? '');
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
    if (mode !== 'login' && password !== password2) return setError(t('Hasła nie są takie same.'));
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: err } = await auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(translate(err.message));
      } else if (mode === 'signup') {
        const { data, error: err } = await auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { emailRedirectTo: appUrl(), data: { invite_code: code.trim().toUpperCase() } },
        });
        if (err) setError(translate(err.message));
        else if (!data.session) setInfo(t('Konto utworzone. Zaloguj się.'));
        else history.replaceState(null, '', location.pathname + location.hash);
      } else {
        const { data, error: err } = await backend.client!.functions.invoke('tmt-api', {
          body: { action: 'reset', email: email.trim().toLowerCase(), code: code.trim().toUpperCase(), password },
        });
        if (err || !data?.ok) {
          const ctx = (err as { context?: Response } | null)?.context;
          const body = ctx ? await ctx.json().catch(() => ({})) : {};
          setError(body.error === 'no_account' ? t('Konto jeszcze nie istnieje — użyj „Pierwsze logowanie”.') : t('Nieprawidłowy lub wygasły kod. Poproś przełożonego o nowy kod.'));
        } else {
          const { error: e2 } = await auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
          if (e2) setError(translate(e2.message));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, [string, string, string]> = {
    login: ['TMT Grafik', t('Zaloguj się, aby zobaczyć grafik i obsadę.'), t('Zaloguj')],
    signup: [t('Pierwsze logowanie'), t('Wpisz e-mail i kod aktywacyjny od przełożonego, potem ustaw hasło.'), t('Utwórz konto')],
    reset: [t('Nie pamiętam hasła'), t('Poproś przełożonego o nowy kod i ustaw nowe hasło.'), t('Ustaw hasło')],
  };
  const [title, sub, cta] = titles[mode];

  return (
    <Frame title={title} sub={sub}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          {t('E-mail')}
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'login' && (
          <label className="field">
            {t('Kod aktywacyjny')}
            <input
              required
              autoComplete="one-time-code"
              autoCapitalize="characters"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ fontFamily: 'monospace', letterSpacing: 4, fontSize: 18 }}
            />
          </label>
        )}
        {(
          <label className="field">
            {mode !== 'login' ? t('Nowe hasło (min. 6 znaków)') : t('Hasło')}
            <input
              type="password"
              autoComplete={mode !== 'login' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode !== 'login' && (
          <label className="field">
            {t('Powtórz hasło')}
            <input type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>
        )}
        {error && <div className="note red" role="alert">{error}</div>}
        {info && <div className="note green" role="status">{info}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t('Chwileczkę…') : cta}
        </button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {mode !== 'login' ? (
          <button type="button" className="btn ghost small" onClick={() => switchTo('login')}>
            {t('← Logowanie')}
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost small" onClick={() => switchTo('signup')}>
              {t('Pierwsze logowanie')}
            </button>
            <button type="button" className="btn ghost small" onClick={() => switchTo('reset')}>
              {t('Nie pamiętam hasła')}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn ghost small"
        style={{ color: 'var(--muted)' }}
        onClick={() => {
          if (!confirm(t('Odłączyć tę przeglądarkę od zapisanej bazy?'))) return;
          writeCloudConfig(null);
          location.reload();
        }}
      >
        {t('Odłącz zapisane połączenie')}
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
    if (password !== password2) return setError(t('Hasła nie są takie same.'));
    const res = await backend.client?.auth.updateUser({ password });
    if (res?.error) setError(translate(res.error.message));
    else onDone();
  };

  return (
    <Frame title={t('Nowe hasło')} sub={t('Ustaw nowe hasło do TMT Grafik.')}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          Nowe hasło (min. 6 znaków)
          <input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          {t('Powtórz hasło')}
          <input type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </label>
        {error && <div className="note red" role="alert">{error}</div>}
        <button className="btn primary" type="submit">
          {t('Zapisz hasło')}
        </button>
      </form>
    </Frame>
  );
}
