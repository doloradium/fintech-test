import { useState } from 'react';
import { Moon, Sun, Workflow } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { FunnelPage } from '@/funnel/FunnelPage';
import { VersionsPage } from '@/admin/VersionsPage';
import { AnalyticsPage } from '@/admin/AnalyticsPage';
import { AdminTokenField } from '@/admin/AdminTokenField';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Воронка', end: true },
  { to: '/admin/versions', label: 'Версии', end: false },
  { to: '/admin/analytics', label: 'Аналитика', end: false },
];

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const [tokenEpoch, setTokenEpoch] = useState(0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <AdminTokenField onSaved={() => setTokenEpoch((epoch) => epoch + 1)} />
      <div key={tokenEpoch} className="contents">
        {children}
      </div>
    </div>
  );
};

export const App = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <span className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <Workflow className="size-4" aria-hidden />
            <span className="hidden sm:inline">Funnel Runtime</span>
          </span>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item, index) => (
              <NavLink
                key={index}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'text-muted-foreground hover:text-foreground shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <Button variant="ghost" size="icon" className="shrink-0" onClick={toggleTheme} aria-label="Переключить тему">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="w-full flex-1 px-4 py-8 sm:px-6">
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
};
