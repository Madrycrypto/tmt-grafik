import { useState } from 'react';
import { useApp } from '../data/AppContext';
import { t } from '../i18n';

export default function Historia() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const list = state.history.filter((h) => !query || (h.text + h.user).toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Kto, kiedy i co zmienił')}</div>
          <h1>{t('Historia zmian')}</h1>
        </div>
        <label className="field">
          {t('Szukaj')}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('nazwisko, stanowisko…')} />
        </label>
      </div>
      <section className="card">
        {list.length === 0 && <div className="empty">{t('Brak wpisów.')}</div>}
        {list.slice(0, 300).map((h) => (
          <div key={h.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="sub" style={{ width: 150, flex: '0 0 150px' }}>
              {new Date(h.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
              <br />
              {h.user}
            </div>
            <div className="grow" style={{ fontSize: 14 }}>{h.text}</div>
          </div>
        ))}
      </section>
    </>
  );
}
