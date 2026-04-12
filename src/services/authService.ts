import { api } from '@/lib/api';
import type { AuthUser } from '@/data/mockData';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user';
    is_active: boolean;
  };
}

interface MeResponse {
  user_id: string;
  email: string;
  role: 'admin' | 'user';
}

function mapBackendUser(user: LoginResponse['user'] | MeResponse): AuthUser {
  return {
    id: 'id' in user ? user.id : user.user_id,
    email: user.email,
    name: user.email.split('@')[0],
    role: user.role,
  };
}

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    const response = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });

    localStorage.setItem('contacthub_access_token', response.access_token);
    localStorage.setItem('contacthub_refresh_token', response.refresh_token);
    localStorage.setItem('contacthub_user', JSON.stringify(mapBackendUser(response.user)));

    return mapBackendUser(response.user);
  },

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('contacthub_refresh_token');
    try {
      await api.post('/auth/logout', { refresh_token: refreshToken });
    } catch {
      // Ignore errors during logout
    } finally {
      localStorage.removeItem('contacthub_access_token');
      localStorage.removeItem('contacthub_refresh_token');
      localStorage.removeItem('contacthub_user');
    }
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    const token = localStorage.getItem('contacthub_access_token');
    if (!token) return null;

    try {
      const response = await api.get<MeResponse>('/auth/me');
      const user = mapBackendUser(response);
      localStorage.setItem('contacthub_user', JSON.stringify(user));
      return user;
    } catch {
      localStorage.removeItem('contacthub_access_token');
      localStorage.removeItem('contacthub_refresh_token');
      localStorage.removeItem('contacthub_user');
      return null;
    }
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.put('/auth/password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },
};
