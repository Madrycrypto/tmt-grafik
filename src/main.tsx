import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, watchSystemTheme } from './theme';
import { HashRouter, Route, Routes, useParams } from 'react-router-dom';
import { AppProvider, useApp } from './data/AppContext';
import EmployeeApp from './pages/EmployeeApp';
import Layout, { More } from './Layout';
import Grafik from './pages/Grafik';
import Historia from './pages/Historia';
import Linie from './pages/Linie';
import Login, { SetPassword } from './pages/Login';
import Matrix from './pages/Matrix';
import Obsada from './pages/Obsada';
import Pracownicy from './pages/Pracownicy';
import Ustawienia from './pages/Ustawienia';
import Kiosk from './pages/Kiosk';
import Rcp from './pages/Rcp';
import Statystyki from './pages/Statystyki';
import Urlopy from './pages/Urlopy';
import Wiadomosci from './pages/Wiadomosci';
import './index.css';

applyTheme();
watchSystemTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider login={(b) => <Login backend={b} />} recovery={(b, done) => <SetPassword backend={b} onDone={done} />}>
      <Root />
    </AppProvider>
  </StrictMode>,
);

function Root() {
  const { role } = useApp();
  if (role === 'employee') return <EmployeeApp />;
  if (role === 'kiosk') return <Kiosk />;
  return (
      <HashRouter>
        <Routes>
          <Route path="podglad/:id" element={<Preview />} />
          <Route path="kiosk" element={<Kiosk />} />
          <Route element={<Layout />}>
            <Route index element={<Obsada />} />
            <Route path="grafik" element={<Grafik />} />
            <Route path="matrix" element={<Matrix />} />
            <Route path="pracownicy" element={<Pracownicy />} />
            <Route path="linie" element={<Linie />} />
            <Route path="statystyki" element={<Statystyki />} />
            <Route path="urlopy" element={<Urlopy />} />
            <Route path="rcp" element={<Rcp />} />
            <Route path="wiadomosci" element={<Wiadomosci />} />
            <Route path="historia" element={<Historia />} />
            <Route path="ustawienia" element={<Ustawienia />} />
            <Route path="wiecej" element={<More />} />
            <Route path="*" element={<Obsada />} />
          </Route>
        </Routes>
      </HashRouter>
  );
}

function Preview() {
  const { id } = useParams();
  return <EmployeeApp previewId={id} />;
}
