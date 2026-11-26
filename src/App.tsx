import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Login } from './pages/admin/Login';
import { OrdersHistory } from './pages/OrdersHistory';
import { Kiosk } from './pages/user/Kiosk';
import { AuthProvider, useAuth } from './auth/AuthContext';
import './styles/main.css';

const DevUiShowcase = import.meta.env.DEV
  ? lazy(() => import('./pages/dev/UiShowcase').then(module => ({ default: module.UiShowcase })))
  : null;

const ProtectedRoute = () => {
  const { status } = useAuth();
  if (status === 'loading') return <div role="status">Verificando sesión...</div>;
  if (status !== 'authenticated') return <Navigate to="/admin/login" replace />;
  return <Outlet />;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
        {DevUiShowcase && (
          <Route path="/__dev/ui" element={<Suspense fallback={<div role="status">Cargando galería…</div>}><DevUiShowcase /></Suspense>} />
        )}
        {/* Rutas de Administrador */}
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<ProtectedRoute />}>
          <Route path="dashboard" element={<OrdersHistory />} />
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
        </Route>

        {/* Kiosco del cliente: solo menú y pedido (sin ver pedidos). El seguimiento lo hace el personal. */}
        <Route path="/user/:mesa_id" element={<Kiosk />} />

        {/* Redirección por defecto */}
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        
        <Route path="*" element={<div style={{ textAlign: 'center', marginTop: '50px' }}><h1>404 No encontrado</h1><p>La ruta no existe.</p></div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
