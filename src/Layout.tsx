import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from './data/AppContext';
import { Icon, LangSwitch, usePersistent } from './ui';
import { t } from './i18n';

export const NAV = [
  { to: '/', label: 'Obsada', icon: 'obsada', mobile: true },
  { to: '/grafik', label: 'Grafik brygad', short: 'Grafik', icon: 'grafik', mobile: true },
  { to: '/matrix', label: 'Matrix kompetencji', short: 'Matrix', icon: 'matrix', mobile: true },
  { to: '/pracownicy', label: 'Pracownicy', short: 'Ludzie', icon: 'ludzie', mobile: true },
  { to: '/rcp', label: 'RCP — obecność', short: 'RCP', icon: 'rcp' },
  { to: '/linie', label: 'Linie i stanowiska', icon: 'linie' },
  { to: '/historia', label: 'Historia zmian', icon: 'historia' },
  { to: '/ustawienia', label: 'Ustawienia', icon: 'ustawienia' },
];

function SyncBadge({ dark }: { dark?: boolean }) {
  const { backend, sync, syncError } = useApp();
  const color = dark ? '#9eabc2' : 'var(--muted)';
  if (backend.mode === 'demo') return <span className="sync" style={{ color }}>{t('Tryb demo (dane w tej przeglądarce)')}</span>;
  if (sync === 'error')
    return (
      <span className="sync" style={{ color: '#ff8a8a' }} title={syncError ?? ''}>
        ● <span className="sync-text">{t('Błąd zapisu')}</span>
      </span>
    );
  return (
    <span className="sync" style={{ color }} title={t('Zmiany zapisują się automatycznie')}>
      <span style={{ color: sync === 'saving' ? '#f5b74a' : '#6cc08f' }}>●</span> <span className="sync-text">{sync === 'saving' ? t('Zapisywanie…') : t('Zsynchronizowano')}</span>
    </span>
  );
}

function UndoButtons({ dark, compact }: { dark?: boolean; compact?: boolean }) {
  const { undoLabel, redoLabel, undo, redo, canEdit } = useApp();
  if (!canEdit) return null;
  const style = dark ? { color: '#fff', borderColor: '#3a4660', background: 'transparent' } : undefined;
  return (
    <span className="undo-bar" style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="btn small" style={style} disabled={!undoLabel} onClick={undo} title={undoLabel ? `${t('Cofnij')}: ${undoLabel} (Ctrl+Z)` : t('Nic do cofnięcia')} aria-label={t('Cofnij')}>
        ↶{compact ? '' : ` ${t('Cofnij')}`}
      </button>
      <button type="button" className="btn small" style={style} disabled={!redoLabel} onClick={redo} title={redoLabel ? `${t('Ponów')}: ${redoLabel} (Ctrl+Shift+Z)` : t('Nic do ponowienia')} aria-label={t('Ponów')}>
        ↷
      </button>
    </span>
  );
}

export default function Layout() {
  const { user } = useApp();
  const [mini, setMini] = usePersistent('sidebar-mini', false);
  return (
    <div className="shell">
      <aside className={`sidebar ${mini ? 'mini' : ''}`} aria-label={t('Menu główne')}>
        <div className="side-head">
          {!mini && (
            <div>
              <div className="brand">{t('TMT Grafik')}</div>
              <div className="brand-sub">{t('Brygady · Matrix · Zastępstwa')}</div>
            </div>
          )}
          <button
            type="button"
            className="side-toggle"
            aria-label={mini ? t('Rozwiń menu') : t('Zwiń menu')}
            aria-expanded={!mini}
            title={mini ? t('Rozwiń menu') : t('Zwiń menu')}
            onClick={() => setMini(!mini)}
          >
            {mini ? '»' : '«'}
          </button>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link" title={mini ? t(n.label) : undefined} aria-label={mini ? t(n.label) : undefined}>
            <Icon name={n.icon} />
            {!mini && t(n.label)}
          </NavLink>
        ))}
        <div className="side-foot">
          <UndoButtons dark compact={mini} />
          {!mini && <LangSwitch dark />}
          <SyncBadge dark />
          {!mini && <span>{user}</span>}
        </div>
      </aside>
      <header className="mobile-top">
        <strong style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{t('TMT Grafik')}</strong>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <UndoButtons dark compact />
          <SyncBadge dark />
          <LangSwitch dark />
        </span>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={t('Menu')}>
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon name={n.icon} />
            {t(n.short ?? n.label)}
          </NavLink>
        ))}
        <NavLink to="/wiecej">
          <Icon name="wiecej" />
          {t('Więcej')}
        </NavLink>
      </nav>
    </div>
  );
}

export function More() {
  return (
    <div className="card more-list">
      <h1 style={{ marginBottom: 6 }}>{t('Więcej')}</h1>
      {NAV.filter((n) => !n.mobile).map((n) => (
        <NavLink key={n.to} to={n.to}>
          <Icon name={n.icon} />
          {t(n.label)}
        </NavLink>
      ))}
    </div>
  );
}
