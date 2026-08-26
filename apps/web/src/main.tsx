import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { ThemeProvider } from './lib/theme';
import { Toaster } from './components/ui/sonner';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('root container is missing in index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
        <Toaster position="bottom-right" richColors />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
