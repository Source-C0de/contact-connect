import { useEffect, useRef } from 'react';
import { authService } from '@/services/authService';
import { adminService } from '@/services/adminService';

/**
 * useSessionManager — enforces admin-configured session policy.
 * - Inactivity timeout: auto-logout after N minutes without user interaction.
 * - Logout on browser close: uses navigator.sendBeacon to logout on tab close.
 */
export function useSessionManager() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef({ inactivity_timeout_minutes: 30, logout_on_browser_close: false });
  const fetchedRef = useRef(false); // prevents duplicate fetches on re-renders
  const cleanupRef = useRef<(() => void) | null>(null);

  // Effect 1: Fetch settings once and set up inactivity timer
  useEffect(() => {
    const token = localStorage.getItem('contacthub_access_token');
    if (!token || fetchedRef.current) return;
    fetchedRef.current = true;

    const doLogout = async () => {
      await authService.logout();
      window.location.href = '/login';
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const mins = settingsRef.current.inactivity_timeout_minutes;
      if (mins <= 0) return;
      timerRef.current = setTimeout(doLogout, mins * 60 * 1000);
    };

    adminService.getSessionSettings()
      .then(settings => {
        settingsRef.current = settings;

        if (settings.inactivity_timeout_minutes > 0) {
          const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
          events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
          resetTimer(); // Start the initial timer

          // Store cleanup so effect teardown can call it
          cleanupRef.current = () => {
            events.forEach(e => window.removeEventListener(e, resetTimer));
            if (timerRef.current) clearTimeout(timerRef.current);
          };
        }
      })
      .catch(() => {
        // Non-admin users (role=user) get 403 — silently skip
      });

    // React cleanup: runs when component unmounts
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      fetchedRef.current = false;
    };
  }, []); // Empty deps — runs once per mount

  // Effect 2: Logout on browser close via sendBeacon
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!settingsRef.current.logout_on_browser_close) return;
      const refreshToken = localStorage.getItem('contacthub_refresh_token');
      if (!refreshToken) return;

      navigator.sendBeacon(
        `${import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1'}/auth/logout`,
        JSON.stringify({ refresh_token: refreshToken })
      );
      localStorage.removeItem('contacthub_access_token');
      localStorage.removeItem('contacthub_refresh_token');
      localStorage.removeItem('contacthub_user');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // Empty deps — runs once per mount
}

