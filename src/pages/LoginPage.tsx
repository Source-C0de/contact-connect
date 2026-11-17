import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppLogo } from '@/components/AppLogo';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If a session already exists (e.g. user navigated back), send them home.
  useEffect(() => {
    if (user) {
      const target = user.role === 'admin' ? '/admin/dashboard' : '/user/directory';
      navigate(target, { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const authedUser = await login(email, password);
      navigate(
        authedUser?.role === 'admin' ? '/admin/dashboard' : '/user/directory',
        { replace: true },
      );
    } catch (err) {
      // Show the real reason instead of a blanket "Invalid email or
      // password". A network failure (server down, wrong port, blocked
      // firewall) is a completely different problem from a wrong password,
      // and collapsing both into one message makes production issues
      // impossible to diagnose from the browser.
      const status = (err as { status?: number } | null)?.status;
      const message = (err as { message?: string } | null)?.message || '';

      if (status === 401) {
        setError('Invalid email or password');
      } else if (status === 503) {
        setError(
          'Cannot reach the ContactHub server. Check that the app container is running and reachable from this machine.',
        );
      } else if (status && status >= 500) {
        setError(`Server error (${status}). Check the app container logs.`);
      } else if (/network error|failed to fetch/i.test(message)) {
        setError(
          'Cannot reach the ContactHub server. Check your network connection and that the server is online.',
        );
      } else {
        setError(message || 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-card p-8 shadow-lg border border-border">
        <div className="text-center">
          <AppLogo className="mx-auto h-24 w-auto" />
          <h1 className="mt-4 text-2xl font-bold text-foreground">AFPC ContactHub</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@corp.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </Button>

          {/* <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Demo Accounts:</p>
            <p>Admin: admin@corp.com / admin123</p>
            <p>User: user@corp.com / user123</p>
          </div> */}
        </form>
      </div>
    </div>
  );
}
