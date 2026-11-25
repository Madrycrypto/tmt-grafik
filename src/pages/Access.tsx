import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../data/AppContext';
import type { Role } from '../data/AppContext';
import { appUrl } from '../data/backend';
import { t } from '../i18n';
import { inviteCode } from '../domain/notify';

type StaffRole = Exclude<Role, 'employee'>;

interface Allowed {
  email: string;
  role: StaffRole;
  invite_code: string | null;
}

export function codeExpiry(): string {
  return new Date(Date.now() + 14 * 86_400_000).toISOString();
}

const ROLE_INFO: Record<StaffRole, string> = {
  admin: t('admin — wszystko + zarządzanie dostępem'),
  editor: t('edytor — zmienia grafik, obsadę, matrycę'),
  viewer: t('podgląd — tylko ogląda'),
};

/** Lista osób z dostępem do aplikacji. Widoczna tylko dla admina w trybie z bazą. */
export default function Access() {
  const { backend, role, user } = useApp();
  const [list, setList] = useState<Allowed[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const db = backend.client;

  const load = useCallback(async () => {
    if (!db) return;
    const { data, error: err } = await db.from('allowed_users').select('email,role,invite_code').neq('role', 'employee').order('email');
    if (err) setError(err.message);
    else setList(data as Allowed[]);
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  if (backend.mode !== 'cloud' || role !== 'admin' || !db) return null;

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setError(null);
    setInfo(null);
    const { error: err } = await p;
    if (err) setError(err.message.includes('duplicate') ? t('Ten e-mail już jest na liście.') : err.message);
    else {
      setInfo(ok);
      await load();
    }
  };

  const add = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setError(t('Podaj poprawny adres e-mail.'));
    const code = inviteCode();
    void run(
      db.from('allowed_users').insert({ email: e, role: newRole, invite_code: code, code_expires: codeExpiry() }),
      t('Dodano {email}. Kod aktywacyjny: {code}. Przekaż tej osobie adres {url} i kod — przy pierwszym wejściu wybiera „Pierwsze logowanie”.', { email: e, url: appUrl(), code }),
    );
    setEmail('');
  };

  return (
    <section className="card stack">
      <h2>{t('Dostęp do aplikacji')}</h2>
      <p className="sub" style={{ margin: 0 }}>
        {t('Tylko osoby z tej listy mogą założyć konto i zobaczyć dane. Usunięcie z listy natychmiast odcina dostęp.')}
      </p>
      <div className="row">
        <label className="field grow" style={{ minWidth: 220 }}>
          {t('E-mail')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('lider.zmiany@firma.pl')} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <label className="field">
          {t('Rola')}
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)}>
            {(Object.keys(ROLE_INFO) as StaffRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={!email.trim()} onClick={add}>
          {t('Dodaj')}
        </button>
      </div>
      {error && <div className="note red">{error}</div>}
      {info && <div className="note green">{info}</div>}
      {list.map((a) => {
        const me = a.email.toLowerCase() === user.toLowerCase();
        return (
          <div key={a.email} className="list-item">
            <span className="grow">
              <b>{a.email}</b> {me && <span className="tag blue">{t('Ty')}</span>}
              {a.invite_code && (
                <div className="sub">
                  {t('Kod aktywacyjny')}: <b style={{ fontFamily: 'monospace', letterSpacing: 2 }}>{a.invite_code}</b>
                </div>
              )}
            </span>
            {!me && (
              <button
                type="button"
                className="btn small"
                title={t('Nowy kod do pierwszego logowania albo zmiany hasła')}
                onClick={() => {
                  const code = inviteCode();
                  void run(db.from('allowed_users').update({ invite_code: code, code_expires: codeExpiry() }).eq('email', a.email), t('Nowy kod dla {email}: {code}', { email: a.email, code }));
                }}
              >
                {t('Nowy kod')}
              </button>
            )}
            <select
              className="input"
              aria-label={`Rola ${a.email}`}
              value={a.role}
              disabled={me}
              onChange={(e) => void run(db.from('allowed_users').update({ role: e.target.value }).eq('email', a.email), t('Zmieniono rolę {email}.', { email: a.email }))}
            >
              {(Object.keys(ROLE_INFO) as StaffRole[]).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn small"
              disabled={me}
              title={me ? t('Nie możesz usunąć samego siebie') : ''}
              onClick={() => confirm(t('Odebrać dostęp {email}?', { email: a.email })) && void run(db.from('allowed_users').delete().eq('email', a.email), t('Odebrano dostęp {email}.', { email: a.email }))}
            >
              {t('Usuń')}
            </button>
          </div>
        );
      })}
    </section>
  );
}
