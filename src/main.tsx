import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'primereact/resources/themes/lara-light-indigo/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import 'sweetalert2/dist/sweetalert2.min.css';
import './index.css'
import './styles/primereact.css';
import './styles/primereact-overrides.css';
import './styles/application.css';
import './config/primeReact';
import App from './App.tsx'
import { PrimeReactProvider } from 'primereact/api';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrimeReactProvider value={{ ripple: true, inputStyle: 'outlined', locale: 'es-SV', unstyled: false }}>
      <App />
    </PrimeReactProvider>
  </StrictMode>,
)
