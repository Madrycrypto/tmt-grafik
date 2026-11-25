import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from './data/AppContext';
import { Icon, LangSwitch } from './ui';
import { t } from './i18n';

export const NAV = [
  { to: '/', label: 'Obsada', icon: 'obsada', mobile: true },
  { to: '/grafik', label: 'Grafik brygad', short: 'Grafik', icon: 'grafik', mobile: true },
  { to: '/matrix', label: 'Matrix kompetencji', short: 'Matrix', icon: 'matrix', mobile: true },
  { to: '/pracownicy', label: 'Pracownicy', short: 'Ludzie', icon: 'ludzie', mobile: true },
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
        {t('● Błąd zapisu')}
      </span>
    );
  return (
    <span className="sync" style={{ color }}>
      <span style={{ color: sync === 'saving' ? '#f5b74a' : '#6cc08f' }}>●</span> {sync === 'saving' ? t('Zapisywanie…') : t('Zsynchronizowano')}
    </span>
  );
}

export default function Layout() {
  const { user } = useApp();
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t('Menu główne')}>
        <div className="brand">{t('TMT Grafik')}</div>
        <div className="brand-sub">{t('Brygady · Matrix · Zastępstwa')}</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
            <Icon name={n.icon} />
            {t(n.label)}
          </NavLink>
        ))}
        <div className="side-foot">
          <LangSwitch dark />
          <SyncBadge dark />
          <span>{user}</span>
        </div>
      </aside>
      <header className="mobile-top">
        <strong style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{t('TMT Grafik')}</strong>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
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
