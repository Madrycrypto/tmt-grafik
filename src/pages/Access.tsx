import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../data/AppContext';
import type { Role } from '../data/AppContext';
import { appUrl } from '../data/backend';
import { t } from '../i18n';

interface Allowed {
  email: string;
  role: Role;
}

const ROLE_INFO: Record<Role, string> = {
  admin: t('admin — wszystko + zarządzanie dostępem'),
  editor: t('edytor — zmienia grafik, obsadę, matrycę'),
  viewer: t('podgląd — tylko ogląda'),
};

/** Lista osób z dostępem do aplikacji. Widoczna tylko dla admina w trybie z bazą. */
export default function Access() {
  const { backend, role, user } = useApp();
  const [list, setList] = useState<Allowed[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const db = backend.client;

  const load = useCallback(async () => {
    if (!db) return;
    const { data, error: err } = await db.from('allowed_users').select('email,role').order('email');
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
    void run(
      db.from('allowed_users').insert({ email: e, role: newRole }),
      t('Dodano {email}. Przekaż tej osobie adres {url} — przy pierwszym wejściu wybiera „Pierwsze logowanie” i ustawia hasło.', { email: e, url: appUrl() }),
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
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
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
            </span>
            <select
              className="input"
              aria-label={`Rola ${a.email}`}
              value={a.role}
              disabled={me}
              onChange={(e) => void run(db.from('allowed_users').update({ role: e.target.value }).eq('email', a.email), t('Zmieniono rolę {email}.', { email: a.email }))}
            >
              {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
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
