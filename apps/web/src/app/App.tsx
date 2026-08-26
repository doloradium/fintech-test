import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { FunnelPage } from '../funnel/FunnelPage';
import { VersionsPage } from '../admin/VersionsPage';
import { AnalyticsPage } from '../admin/AnalyticsPage';
import { getAdminToken, setAdminToken } from '../lib/api';

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState(getAdminToken());

  return (
    <div className="stack">
      <section className="card card--tight">
        <label className="field">
          <span className="field__label">Админ-токен (только если задана переменная ADMIN_TOKEN)</span>
          <input
            className="input"
            type="password"
            value={token}
            placeholder="оставьте пустым, если токен не задан"
            onChange={(event) => {
              setToken(event.target.value);
              setAdminToken(event.target.value);
            }}
          />
        </label>
      </section>
      {children}
    </div>
  );
};

export const App = () => (
  <div className="shell">
    <header className="topbar">
      <span className="topbar__brand">Funnel Runtime</span>
      <nav className="topbar__nav">
        <NavLink to="/" end>
          Воронка
        </NavLink>
        <NavLink to="/admin/versions">Версии</NavLink>
        <NavLink to="/admin/analytics">Аналитика</NavLink>
      </nav>
    </header>

    <main className="content">
      <Routes>
        <Route path="/" element={<FunnelPage />} />
        <Route path="/admin" element={<Navigate to="/admin/versions" replace />} />
        <Route
          path="/admin/versions"
          element={
            <AdminLayout>
              <VersionsPage />
            </AdminLayout>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <AdminLayout>
              <AnalyticsPage />
            </AdminLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  </div>
);
