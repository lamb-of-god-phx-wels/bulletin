import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installBrowserApi } from './browserApi';
import { AppErrorBoundary } from './components/AppErrorBoundary';

await installBrowserApi();
createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);
