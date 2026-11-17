import { api } from '@/lib/api';
import { absoluteApiUrl } from '@/lib/apiBase';
import type { AuthUser } from '@/data/mockData';

interface BackendUser {
  id: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  is_active: boolean;
  // /auth/login returns camelCase via publicUser(); /auth/me returns
  // snake_case. Accept both so one mapper handles both paths.
  photoUrl?: string | null;
  photo_url?: string | null;
}

interface ServerLoginResponse {
  access_token: string;
  refresh_token: string;
  user: BackendUser;
}

interface ServerMeResponse {
  user_id: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  photo_url?: string | null;
}

export function mapBackendUser(user: BackendUser | ServerMeResponse): AuthUser {
  const photo = 'photoUrl' in user ? user.photoUrl : user.photo_url;
  return {
    id: 'id' in user ? user.id : user.user_id,
    email: user.email,
    // Prefer the server-provided display name; fall back to the email
    // local-part for legacy/local-fallback payloads that omit it.
    name: user.name || user.email.split('@')[0],
    role: user.role,
    avatar: absoluteApiUrl(photo || undefined),
  };
}

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    let accessToken = '';
    let refreshToken = '';
    let user: AuthUser;

    try {
      const response = await api.post<ServerLoginResponse>('/auth/login', {
        email,
        password,
      });
      accessToken = response.access_token;
      refreshToken = response.refresh_token || accessToken;
      user = mapBackendUser(response.user);
    } catch (err) {
      // LAN server unreachable -> fall back to per-browser localStorage store.
      //
      // Only fall back when the failure was a CONNECTION problem. A 401 from
      // the server is a genuine "wrong password" and must not be retried
      // against the local mirror, otherwise the user sees a misleading
      // result and the real reason is lost.
      const status = (err as { status?: number } | null)?.status;
      if (status === 401) throw err;

      try {
        const local = await api.__local.request<
          { token: string; user: BackendUser }
        >('POST', '/auth/login', { email, password });
        accessToken = local.token;
        refreshToken = local.token;
        user = mapBackendUser(local.user);
      } catch {
        // The local mirror is unavailable/disabled — surface the ORIGINAL
        // error so the UI can explain what actually went wrong.
        throw err;
      }
    }

    localStorage.setItem('contacthub_access_token', accessToken);
    localStorage.setItem('contacthub_refresh_token', refreshToken);
    localStorage.setItem('contacthub_user', JSON.stringify(user));

    return user;
  },

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('contacthub_refresh_token');
    try {
      await api.post('/auth/logout', { refresh_token: refreshToken });
    } catch {
      // Server unreachable, ignore — we still clear local state.
    } finally {
      localStorage.removeItem('contacthub_access_token');
      localStorage.removeItem('contacthub_refresh_token');
      localStorage.removeItem('contacthub_user');
    }
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    const token = localStorage.getItem('contacthub_access_token');
    if (!token) return null;

    // Helper: rehydrate from cached user blob so a transient network blip
    // (LAN server briefly unreachable, server restarting) doesn't bounce
    // the user to the login screen on every page refresh.
    const cached = (): AuthUser | null => {
      try {
        const raw = localStorage.getItem('contacthub_user');
        return raw ? (JSON.parse(raw) as AuthUser) : null;
      } catch {
        return null;
      }
    };

    try {
      const response = await api.get<ServerMeResponse>('/auth/me');
      const user = mapBackendUser(response);
      localStorage.setItem('contacthub_user', JSON.stringify(user));
      return user;
    } catch (err) {
      // Only the server explicitly rejecting the token (HTTP 401) should
      // wipe the session. Anything else — network failure, server restart,
      // 5xx — keep the cached user so the UI stays stable.
      const status = (err as { status?: number } | null)?.status;
      if (status === 401) {
        localStorage.removeItem('contacthub_access_token');
        localStorage.removeItem('contacthub_refresh_token');
        localStorage.removeItem('contacthub_user');
        return null;
      }
      return cached();
    }
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.put('/auth/password', {
      current_password: oldPassword,
      new_password: newPassword,
    });
  },
};
