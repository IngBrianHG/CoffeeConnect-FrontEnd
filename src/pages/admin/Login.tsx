import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Password } from 'primereact/password';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useAuth } from '../../auth/AuthContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { signIn, status } = useAuth();

  if (status === 'loading') {
    return <main className="login-loading" role="status" aria-label="Verificando sesión">
      <ProgressSpinner style={{ width: '2.5rem', height: '2.5rem' }} strokeWidth="5" />
      <span>Verificando sesión…</span>
    </main>;
  }

  if (status === 'authenticated') return <Navigate to="/admin/dashboard" replace />;

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate('/admin/dashboard', { replace: true });
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : '') || 'No se pudo iniciar sesión. Verifica tus credenciales.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="Coffee Connect y Turrón Pastelería">
        <div className="login-brand__content">
          <img className="login-brand__logo" src="/turron-logo.jpg" alt="Turrón Pastelería" />
          <p className="login-brand__eyebrow">Coffee Connect</p>
          <h1>El sabor de cada día,<br />mejor organizado.</h1>
          <p className="login-brand__description">Herramientas sencillas para cuidar cada detalle de nuestra operación.</p>
          <span className="login-brand__signature">Turrón · Pastelería y café</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-mobile-brand">
            <img src="/turron-logo.jpg" alt="" />
            <span>Coffee Connect</span>
          </div>
          <div className="login-card__heading">
            <span className="login-card__eyebrow">Acceso al personal</span>
            <h2>Bienvenido</h2>
            <p>Ingresa con las credenciales de tu cuenta.</p>
          </div>
          {error && <Message className="login-error" severity="error" text={error} role="alert" />}
          <form className="login-form p-fluid" onSubmit={handleLogin}>
            <div className="login-field">
              <label htmlFor="login-email">Correo electrónico</label>
              <InputText
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
                disabled={isLoading}
                placeholder="nombre@ejemplo.com"
              />
            </div>
            <div className="login-field">
              <label htmlFor="login-password">Contraseña</label>
              <Password
                className="w-full"
                inputId="login-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                feedback={false}
                toggleMask
                autoComplete="current-password"
                required
                disabled={isLoading}
                placeholder="Ingresa tu contraseña"
                inputClassName="w-full"
              />
            </div>
            <Button type="submit" label={isLoading ? 'Ingresando…' : 'Iniciar sesión'} icon={isLoading ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-right'} iconPos="right" loading={isLoading} disabled={isLoading} />
          </form>
          <p className="login-card__footnote">Acceso exclusivo para el equipo de Turrón.</p>
        </div>
      </section>
    </main>
  );
}
