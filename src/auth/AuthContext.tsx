/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { authProvider, type AppSession } from '../services/auth';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
interface AuthContextValue {
  status: AuthStatus;
  session: AppSession | null;
  signIn(email: string, password: string): Promise<AppSession>;
  signOut(): Promise<void>;
  refreshSession(): Promise<AppSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    let mounted = true;
    void authProvider.getSession()
      .then((activeSession) => {
        if (!mounted) return;
        setSession(activeSession);
        setStatus(activeSession ? 'authenticated' : 'unauthenticated');
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setStatus('unauthenticated');
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !session) return;
    const delay = Math.max(0, session.expiresAt - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      void authProvider.getSession()
        .then((activeSession) => {
          setSession(activeSession);
          setStatus(activeSession ? 'authenticated' : 'unauthenticated');
        })
        .catch(() => {
          // Errores de red son recuperables; el guard sigue dependiendo del estado
          // de sesión ya validado, no de datos persistidos.
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [session, status]);

  const signIn = useCallback(async (email: string, password: string) => {
    const activeSession = await authProvider.signIn(email, password);
    setSession(activeSession);
    setStatus('authenticated');
    return activeSession;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authProvider.signOut();
    } finally {
      setSession(null);
      setStatus('unauthenticated');
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const activeSession = await authProvider.getSession();
    setSession(activeSession);
    setStatus(activeSession ? 'authenticated' : 'unauthenticated');
    return activeSession;
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, signIn, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
