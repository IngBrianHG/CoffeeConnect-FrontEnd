export type AppRole = 'admin' | 'cashier' | 'waiter';

export interface AppSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
  profile: {
    id: string;
    displayName: string;
    role: AppRole;
    active: boolean;
  };
}

export interface AuthProvider {
  signIn(email: string, password: string): Promise<AppSession>;
  getSession(): Promise<AppSession | null>;
  signOut(): Promise<void>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

interface SupabaseProfile {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
const PUBLIC_KEY = import.meta.env.VITE_API_PUBLIC_KEY;
const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';
const SESSION_STORAGE_KEY = 'coffee-connect-auth';
let currentSession: AppSession | null = null;
let refreshInFlight: Promise<AppSession | null> | null = null;

interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

function saveSession(session: AppSession | null) {
  currentSession = session;
  try {
    if (session) {
      const persisted: PersistedSession = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: session.user,
      };
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(persisted));
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Si storage está bloqueado, la sesión puede continuar solo en memoria.
  }
}

function readPersistedSession(): PersistedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof parsed.accessToken !== 'string'
      || typeof parsed.refreshToken !== 'string'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.user?.id !== 'string'
      || typeof parsed.user?.email !== 'string'
    ) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed as PersistedSession;
  } catch {
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignorar storage deshabilitado.
    }
    return null;
  }
}

function configuration(): { baseUrl: string; publicKey: string } {
  if (!BASE_URL || !PUBLIC_KEY) {
    throw new AuthError('La autenticación no está configurada. Contacta al administrador.');
  }
  return { baseUrl: BASE_URL, publicKey: PUBLIC_KEY };
}

async function jsonResponse<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function validRole(role: string): role is AppRole {
  return role === 'admin' || role === 'cashier' || role === 'waiter';
}

async function fetchProfile(tokenData: SupabaseTokenResponse): Promise<AppSession> {
  const { baseUrl, publicKey } = configuration();
  const url = new URL(`${baseUrl}/rest/v1/profiles`);
  url.searchParams.set('select', 'id,display_name,role,active');
  url.searchParams.set('id', `eq.${tokenData.user.id}`);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { apikey: publicKey, Authorization: `Bearer ${tokenData.access_token}` },
    });
  } catch {
    throw new AuthError('No se pudo conectar con el servicio. Intenta nuevamente.');
  }
  if (response.status === 401) throw new AuthError('La sesión no pudo validarse. Inicia sesión nuevamente.');
  if (!response.ok) throw new AuthError('No se pudo validar el perfil. Intenta nuevamente.');
  const profiles = await jsonResponse<SupabaseProfile[]>(response);
  const profile = Array.isArray(profiles) && profiles.length === 1 ? profiles[0] : null;
  if (!profile || !profile.active || !validRole(profile.role)) {
    throw new AuthError('Tu cuenta no tiene acceso al panel.');
  }
  const email = tokenData.user.email;
  if (!email) throw new AuthError('La sesión recibida no es válida.');
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    user: { id: tokenData.user.id, email },
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      role: profile.role,
      active: profile.active,
    },
  };
}

async function requestToken(
  grantType: 'password' | 'refresh_token',
  body: Record<string, string>,
): Promise<SupabaseTokenResponse> {
  const { baseUrl, publicKey } = configuration();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('No se pudo conectar con el servicio. Intenta nuevamente.');
  }
  const result = await jsonResponse<SupabaseTokenResponse>(response);
  if (!response.ok || !result?.access_token || !result.refresh_token || !result.user?.id) {
    if (grantType === 'password' && (response.status === 400 || response.status === 401)) {
      throw new AuthError(INVALID_CREDENTIALS);
    }
    throw new AuthError(grantType === 'refresh_token'
      ? 'La sesión expiró. Inicia sesión nuevamente.'
      : 'No se pudo iniciar sesión. Intenta nuevamente.');
  }
  return result;
}

async function refreshSession(): Promise<AppSession | null> {
  if (!currentSession) return null;
  if (!refreshInFlight) {
    const refreshToken = currentSession.refreshToken;
    refreshInFlight = (async () => {
      try {
        const tokenData = await requestToken('refresh_token', { refresh_token: refreshToken });
        const session = await fetchProfile(tokenData);
        saveSession(session);
        return session;
      } catch {
        saveSession(null);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export const authProvider: AuthProvider = {
  async signIn(email, password) {
    saveSession(null);
    try {
      const tokenData = await requestToken('password', { email, password });
      const session = await fetchProfile(tokenData);
      saveSession(session);
      return session;
    } catch (error) {
      saveSession(null);
      throw error;
    }
  },

  async getSession() {
    if (!currentSession) {
      const persisted = readPersistedSession();
      if (!persisted) return null;
      currentSession = {
        ...persisted,
        profile: { id: persisted.user.id, displayName: '', role: 'waiter', active: true },
      };
    }
    if (currentSession.expiresAt <= Date.now() + 30_000) return refreshSession();
    try {
      const restored = await fetchProfile({
        access_token: currentSession.accessToken,
        refresh_token: currentSession.refreshToken,
        expires_in: Math.max(0, Math.floor((currentSession.expiresAt - Date.now()) / 1000)),
        user: currentSession.user,
      });
      saveSession(restored);
      return restored;
    } catch (error) {
      if (error instanceof AuthError && error.message.includes('sesión no pudo validarse')) {
        return refreshSession();
      }
      if (error instanceof AuthError && error.message === 'Tu cuenta no tiene acceso al panel.') {
        saveSession(null);
      }
      throw error;
    }
  },

  async signOut() {
    const session = currentSession;
    saveSession(null);
    if (!session) return;
    try {
      const { baseUrl, publicKey } = configuration();
      await fetch(`${baseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: publicKey, Authorization: `Bearer ${session.accessToken}` },
      });
    } catch {
      // El cierre local no depende de la disponibilidad remota ni de la configuración.
    }
  },
};
