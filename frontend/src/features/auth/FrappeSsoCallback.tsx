// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Landing page for the "Sign in with Frappe" OAuth2 callback.
 *
 * The backend's callback (app/modules/sso/router.py) never puts real
 * access/refresh tokens in a redirect URL - it mints a single-use, 60s
 * "handoff" code and sends the browser here instead. This page's only job
 * is to immediately exchange that code for the real TokenResponse via one
 * more POST, then hand off to the exact same setTokens + navigate pattern
 * every other login path uses (see LoginPageNext.tsx's handleDemoLogin for
 * the precedent this mirrors).
 *
 * Renders no error UI of its own - any failure redirects back to /login
 * with ?sso_error=<code>, so every SSO error surfaces through exactly one
 * place: LoginPage.tsx's existing banner.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/shared/ui';
import { useAuthStore } from '@/stores/useAuthStore';
import { AuthBackground } from './AuthBackground';
import { safeNextPath } from './nextPath';

export function FrappeSsoCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setTokens = useAuthStore((s) => s.setTokens);
  // Effects run twice under StrictMode in dev; the handoff code is
  // single-use server-side, so a duplicate exchange would 401 on the
  // second call and bounce the user back to /login for no reason.
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) {
      navigate('/login?sso_error=missing_params', { replace: true });
      return;
    }

    void (async () => {
      try {
        const res = await fetch('/api/v1/sso/frappe/exchange/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const detail = typeof data?.detail === 'string' ? data.detail : 'idp_unreachable';
          navigate(`/login?sso_error=${encodeURIComponent(detail)}`, { replace: true });
          return;
        }
        const data = (await res.json()) as { access_token: string; refresh_token: string };
        setTokens(data.access_token, data.refresh_token);
        navigate(safeNextPath(location.search), { replace: true });
      } catch {
        navigate('/login?sso_error=idp_unreachable', { replace: true });
      }
    })();
    // Mount-only: the code is single-use, this must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex h-screen flex-col items-center justify-center bg-surface-secondary overflow-hidden">
      <AuthBackground />
      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <Logo size="lg" animate />
        <svg className="h-7 w-7 animate-spin text-oe-blue" viewBox="0 0 24 24" aria-hidden>
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <p className="text-sm font-medium text-content-secondary">
          {t('auth.preparing_workspace', { defaultValue: 'Preparing your workspace...' })}
        </p>
      </div>
    </div>
  );
}
