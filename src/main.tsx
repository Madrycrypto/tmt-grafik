import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './data/AppContext';
import Layout, { More } from './Layout';
import Grafik from './pages/Grafik';
import Historia from './pages/Historia';
import Linie from './pages/Linie';
import Login from './pages/Login';
import Matrix from './pages/Matrix';
import Obsada from './pages/Obsada';
import Pracownicy from './pages/Pracownicy';
import Ustawienia from './pages/Ustawienia';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider login={(b) => <Login backend={b} />}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Obsada />} />
            <Route path="grafik" element={<Grafik />} />
            <Route path="matrix" element={<Matrix />} />
            <Route path="pracownicy" element={<Pracownicy />} />
            <Route path="linie" element={<Linie />} />
            <Route path="historia" element={<Historia />} />
            <Route path="ustawienia" element={<Ustawienia />} />
            <Route path="wiecej" element={<More />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  </StrictMode>,
);
