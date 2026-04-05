import { mockAuthUsers, type AuthUser } from '@/data/mockData';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    await delay(800);
    const user = mockAuthUsers[email];
    if (!user || user.password !== password) {
      throw new Error('Invalid email or password');
    }
    const { password: _, ...authUser } = user;
    localStorage.setItem('contacthub_user', JSON.stringify(authUser));
    return authUser;
  },

  async logout(): Promise<void> {
    await delay(300);
    localStorage.removeItem('contacthub_user');
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    await delay(100);
    const stored = localStorage.getItem('contacthub_user');
    return stored ? JSON.parse(stored) : null;
  },
};
