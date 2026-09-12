// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Eye, EyeOff, Mail, Lock, Globe, ChevronDown, X,
  FileSpreadsheet, CalendarClock, TrendingUp, Boxes, Database,
  BarChart3, Upload, FileCheck,
  Sun, Moon, Monitor,
} from 'lucide-react';
import { Button, Logo, LogoWithText, CountryFlag } from '@/shared/ui';
import { useAuthStore } from '@/stores/useAuthStore';
import { extractErrorMessageFromBody } from '@/shared/lib/api';
import { isTauri } from '@/shared/lib/desktop';
import { loginFailureKindFromResponse } from './loginError';
import { AuthBackground } from './AuthBackground';
import {
  shouldAttemptDesktopBootstrap,
  shouldQueryFirstRun,
  type FirstRunStatus,
} from './desktopBootstrap';
import { safeNextPath } from './nextPath';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { useThemeStore } from '@/stores/useThemeStore';

/** English fallbacks for every ?sso_error= code the backend's Frappe OAuth
 *  flow (app/modules/sso/router.py) or FrappeSsoCallback.tsx can append to
 *  the /login redirect. Used as the i18n defaultValue and as the plain
 *  fallback when a translation key is somehow missing. */
const SSO_ERROR_FALLBACKS: Record<string, string> = {
  not_configured: 'Sign in with Frappe is not available on this server.',
  denied: 'You cancelled sign-in with Frappe.',
  missing_params: 'Sign-in with Frappe was interrupted. Please try again.',
  state_invalid: 'Your sign-in attempt expired. Please try again.',
  state_expired: 'Your sign-in attempt expired. Please try again.',
  idp_unreachable: 'Could not reach the Frappe server. Please try again in a moment.',
  idp_no_email: "Your Frappe account has no e-mail address, so it can't sign in here.",
  account_inactive: 'This account is disabled. Contact an administrator.',
  registration_closed: 'Self-registration is disabled. Contact an administrator.',
  pending_approval: 'Your account was created and is waiting for administrator approval.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  handoff_expired: 'Your sign-in link expired. Please try signing in again.',
  handoff_reused: 'Your sign-in link was already used. Please try signing in again.',
  handoff_invalid: 'Your sign-in link is invalid. Please try signing in again.',
  default: 'Sign-in with Frappe failed. Please try again.',
};

/* Segmented theme switch (Light / Dark / System) for the login page. */
function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const opts = [
    { mode: 'light' as const, icon: Sun, label: t('theme.light', { defaultValue: 'Light' }) },
    { mode: 'dark' as const, icon: Moon, label: t('theme.dark', { defaultValue: 'Dark' }) },
    { mode: 'system' as const, icon: Monitor, label: t('theme.system', { defaultValue: 'System' }) },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label', { defaultValue: 'Theme' })}
      className="flex items-center gap-0.5 rounded-xl border border-border-light bg-surface-elevated/85 backdrop-blur-sm p-0.5 shadow-sm"
    >
      {opts.map(({ mode, icon: Icon, label }) => {
        const active = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            aria-label={label}
            onClick={() => setTheme(mode)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              active
                ? 'bg-oe-blue text-white shadow-sm'
                : 'text-content-tertiary hover:text-content-secondary hover:bg-surface-secondary'
            }`}
          >
            <Icon size={15} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setTokens = useAuthStore((s) => s.setTokens);
  // `?next=/path` lets guarded routes send the user back to where they wanted
  // to go after login. Falls back to `/` for direct visits. Shared with the
  // authenticated-route guard (AuthedHome) so a redirect race between the two
  // cannot silently drop the `next` (the demo deep-link bug).
  const nextPath = safeNextPath(location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem('oe_remember') === '1',
  );
  const [langOpen, setLangOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [frappeSsoEnabled, setFrappeSsoEnabled] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  // Desktop first-run: when running inside the Tauri shell with no stored
  // token and no deliberate manual logout this session, we silently auto-sign
  // in to the local workspace owner. Seed the pending flag synchronously so the
  // very first paint shows "Preparing your workspace..." rather than flashing
  // the login form before the bootstrap effect runs.
  const [bootstrapping, setBootstrapping] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored =
      localStorage.getItem('oe_access_token') || sessionStorage.getItem('oe_access_token');
    const manual = sessionStorage.getItem('oe_manual_login');
    return shouldQueryFirstRun(isTauri, Boolean(stored), manual);
  });

  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0]!;

  // Clear form on mount (prevents pre-fill after logout)
  useEffect(() => {
    setEmail('');
    setPassword('');
    setError('');
  }, []);

  // Probe whether an admin has configured "Sign in with Frappe" (Settings ->
  // Single Sign-On). Public endpoint, best-effort: a failed probe just keeps
  // the button hidden rather than surfacing an error on page load. Unlike
  // the desktop bootstrap effect above, this always runs (not gated on
  // isTauri) since the button is a normal web-login affordance.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/first-run', { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = (await res.json()) as { frappe_sso_enabled?: boolean };
        if (!cancelled) setFrappeSsoEnabled(data.frappe_sso_enabled === true);
      } catch {
        /* stay hidden on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Surface an SSO failure (denied consent, expired state, IdP unreachable,
  // ...) through the existing error banner. `sso_error` is appended by the
  // backend's OAuth callback redirect (see app/modules/sso/router.py) or by
  // FrappeSsoCallback.tsx when the handoff exchange itself fails.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('sso_error');
    if (!code) return;
    setError(t(`auth.sso_error.${code}`, { defaultValue: SSO_ERROR_FALLBACKS[code] ?? SSO_ERROR_FALLBACKS.default! }));
    // Mount-only: read once, don't re-trigger on unrelated search-string
    // churn (e.g. the demo-hint popover doesn't touch the query string, but
    // future additions might).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop auto-bootstrap. Runs once on mount. On ANY failure it silently
  // falls back to the normal login form (clears `bootstrapping`); it never
  // surfaces an error to the user because manual login is always a valid path.
  useEffect(() => {
    if (!bootstrapping) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch('/api/v1/auth/first-run', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('first-run probe failed');
        const status = (await res.json()) as FirstRunStatus;

        const manual = sessionStorage.getItem('oe_manual_login');
        if (!shouldAttemptDesktopBootstrap(status, false, manual)) {
          throw new Error('bootstrap not applicable');
        }

        const bootRes = await fetch('/api/v1/auth/desktop-bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!bootRes.ok) throw new Error('desktop bootstrap failed');
        const data = (await bootRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          user?: { email?: string };
        };
        if (!data.access_token || !data.refresh_token) {
          throw new Error('bootstrap response missing tokens');
        }
        if (cancelled) return;

        // Persist through the existing auth store path with remember=true so the
        // desktop owner stays signed in across launches.
        setTokens(data.access_token, data.refresh_token, true, data.user?.email);
        navigate(status.onboarding_completed === true ? '/dashboard' : '/onboarding', {
          replace: true,
        });
      } catch {
        // Silent fallback to the manual login form.
        if (!cancelled) setBootstrapping(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // Mount-only: the gate inputs are read fresh inside `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/users/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        // A proxy answering 502 for a backend that is down is a response, not
        // a network error, so the catch below never sees it. Without this the
        // outage lands on the credentials wording and the person is told the
        // one thing we know is untrue: nothing read their password. A 4xx
        // carrying no message we can read is that same outage told by whatever
        // stands in front of us, so the body decides alongside the status.
        const data = await res.json().catch(() => null);
        const parsed = extractErrorMessageFromBody(data);
        if (loginFailureKindFromResponse(res.status, parsed) === 'unavailable') {
          setError(
            t('auth.server_unavailable', {
              defaultValue:
                'The server did not answer, so your details were never checked. Try again in a moment.',
            }),
          );
          return;
        }
        setError(parsed || t('auth.invalid_credentials', 'Invalid email or password'));
        return;
      }
      const data = await res.json();
      setTokens(data.access_token, data.refresh_token, rememberMe, email);
      navigate(nextPath, { replace: true });
    } catch {
      setError(t('auth.connection_error', 'Unable to connect to server. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  /* Benefits list - reserved for future hero section layout
  const benefits = [
    { icon: HardDrive, color: 'text-emerald-500 bg-emerald-500/10', title: t('login.benefit.local', 'Your data stays on your computer'), desc: t('login.benefit.local_desc', 'No cloud. No third-party servers. Full control.') },
    { icon: ShieldCheck, color: 'text-blue-500 bg-blue-500/10', title: t('login.benefit.open_source', '100% open source'), desc: t('login.benefit.open_source_desc', 'Transparent code. No vendor lock-in.') },
    { icon: Globe2, color: 'text-violet-500 bg-violet-500/10', title: t('login.benefit.standards', 'International standards'), desc: t('login.benefit.standards_desc', '120,000+ cost items across 9 cost bases worldwide.') },
    { icon: Brain, color: 'text-amber-500 bg-amber-500/10', title: t('login.benefit.ai', 'AI-assisted estimation'), desc: t('login.benefit.ai_desc', 'Smart suggestions. You decide, AI assists.') },
    { icon: Zap, color: 'text-rose-500 bg-rose-500/10', title: t('login.benefit.allinone', 'BOQ + 4D + 5D + Tendering'), desc: t('login.benefit.allinone_desc', 'Full workflow in one tool.') },
    { icon: Users, color: 'text-cyan-500 bg-cyan-500/10', title: t('login.benefit.free', 'Free for everyone'), desc: t('login.benefit.free_desc', 'No fees. No limits. By estimators.') },
  ]; */

  // Desktop first-run: clean centered pending state while we silently sign in
  // to the local workspace. Falls back to the form on any failure (see effect).
  if (bootstrapping) {
    return (
      <div className="relative flex h-screen flex-col items-center justify-center bg-surface-secondary overflow-hidden">
        <AuthBackground />
        <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
          <Logo size="lg" animate />
          <svg
            className="h-7 w-7 animate-spin text-oe-blue"
            viewBox="0 0 24 24"
            aria-hidden
          >
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

  return (
    <div className="relative flex h-screen items-center justify-center bg-surface-secondary overflow-hidden">
      <AuthBackground />

      {/* Local style block - premium glass variant + drifting orb keyframes
          scoped to the login page. Pattern mirrors LoginPageNext.tsx. */}
      <style>{`
        .login-glass-pro {
          background:
            linear-gradient(135deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.62) 100%);
          backdrop-filter: blur(28px) saturate(180%);
          -webkit-backdrop-filter: blur(28px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.85);
          box-shadow:
            0 36px 80px -28px rgba(14, 165, 233, 0.30),
            0 14px 36px -12px rgba(15, 23, 42, 0.12),
            0 2px 6px -1px rgba(15, 23, 42, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.95),
            inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }
        .dark .login-glass-pro {
          background:
            linear-gradient(135deg, rgba(22, 26, 36, 0.78) 0%, rgba(15, 17, 23, 0.66) 100%);
          border-color: transparent;
          box-shadow:
            0 30px 80px -24px rgba(14, 165, 233, 0.35),
            0 12px 40px -12px rgba(0, 0, 0, 0.55),
            0 2px 6px -2px rgba(0, 0, 0, 0.4);
        }
        .login-glass-pro::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background:
            radial-gradient(120% 80% at 0% 0%, rgba(14, 165, 233, 0.05), transparent 65%);
          mix-blend-mode: soft-light;
        }
        .dark .login-glass-pro::after {
          background:
            radial-gradient(120% 80% at 0% 0%, rgba(14, 165, 233, 0.18), transparent 60%),
            radial-gradient(120% 80% at 100% 100%, rgba(139, 92, 246, 0.16), transparent 60%);
          mix-blend-mode: screen;
        }
        @keyframes login-orb-drift-a {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(30px, -22px, 0) scale(1.08); }
        }
        @keyframes login-orb-drift-b {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(-26px, 28px, 0) scale(0.94); }
        }
        @keyframes login-orb-drift-c {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(20px, 32px, 0) scale(1.05); }
        }
        .login-orb-a { animation: login-orb-drift-a 12s ease-in-out infinite; }
        .login-orb-b { animation: login-orb-drift-b 14s ease-in-out infinite; }
        .login-orb-c { animation: login-orb-drift-c 10s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .login-orb-a, .login-orb-b, .login-orb-c { animation: none; }
        }
      `}</style>

      {/* Ambient mesh blobs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-12%] left-[-6%] w-[520px] h-[520px] rounded-full bg-sky-300/10 dark:bg-oe-blue/35 blur-[110px] animate-blob-slow-1 mix-blend-screen" />
        <div className="absolute bottom-[-18%] right-[2%] w-[400px] h-[400px] rounded-full bg-cyan-200/10 dark:bg-violet-500/35 blur-[110px] animate-blob-slow-4 mix-blend-screen hidden dark:block" />
      </div>

      {/* Theme + Language - top right (enlarged for /login so discoverable). */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        <ThemeSwitch />
        <div className="relative" ref={langRef}>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className="flex items-center gap-2 rounded-xl border border-border-light bg-surface-elevated/85 backdrop-blur-sm px-4 py-2 text-sm font-medium text-content-secondary hover:bg-surface-elevated hover:border-oe-blue/30 transition-colors shadow-sm"
        >
          <Globe size={16} className="text-content-tertiary" />
          <CountryFlag code={currentLang.country} size={20} />
          <span className="hidden sm:inline">{currentLang.name}</span>
          <ChevronDown size={14} className={`text-content-tertiary transition-transform ${langOpen ? 'rotate-180' : ''}`} />
        </button>
        {langOpen && (
          <div className="absolute right-0 mt-2 w-64 max-h-80 overflow-y-auto rounded-xl border border-border-light bg-surface-elevated shadow-xl py-1 animate-stagger-in">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isActive = i18n.language === lang.code;
              const english = 'english' in lang ? (lang as { english?: string }).english : undefined;
              return (
                <button
                  key={lang.code}
                  onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${isActive ? 'bg-oe-blue/10 text-oe-blue font-medium' : 'text-content-primary hover:bg-surface-secondary'}`}
                >
                  <CountryFlag code={lang.country} size={18} />
                  <span className="truncate">
                    {lang.name}
                    {english && (
                      <span className="ml-1 text-2xs text-content-tertiary">({english})</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* ── Centered logo + form (primary action). ── */}
      <div className="relative flex items-center justify-center p-4 sm:p-6 z-10 overflow-hidden">
        <div className="w-full max-w-[460px] relative z-10">
          {/* Form - premium multi-layer glass.
              login-glass-pro adds layered borders, a coloured ambient drop
              shadow, an inset highlight, and a soft-light overlay tint via
              ::after. The DOM-level top sheen below adds the rim-light line. */}
          <div
            className="login-glass-pro relative rounded-2xl px-9 py-8 animate-form-scale-in"
            style={{ animationDelay: '150ms' }}
          >
            {/* Top-edge sheen - bright highlight along the rim */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-9 top-0 h-px rounded-t-2xl"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)',
              }}
            />
            {/* Inner soft glow gradient on the top-left corner */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 w-32 h-32 rounded-tl-2xl opacity-60"
              style={{
                background:
                  'radial-gradient(circle at 0% 0%, rgba(255,255,255,0.5), transparent 70%)',
              }}
            />
            {/* Visually hidden h1 for screen readers + a11y tools - visible text uses h2 below */}
            <h1 className="sr-only">{t('auth.login', 'Sign in')}</h1>
            <div className="animate-stagger-in" style={{ animationDelay: '200ms' }}>
              <h2 className="text-2xl font-semibold text-content-primary mb-1">{t('auth.login', 'Sign in')}</h2>
              <p className="text-sm text-content-secondary mb-6">{t('auth.login_subtitle', 'Enter your credentials to access your workspace')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" aria-label={t('auth.login', 'Sign in')}>
              <div className="flex flex-col gap-1.5 animate-stagger-in" style={{ animationDelay: '280ms' }}>
                <label htmlFor="login-email" className="text-sm font-medium text-content-primary">{t('auth.email', 'Email')}</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-content-tertiary"><Mail size={16} /></div>
                  <input id="login-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required aria-required="true" autoFocus className="h-11 w-full rounded-lg border border-border bg-surface-primary pl-10 pr-3.5 text-base text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 animate-stagger-in" style={{ animationDelay: '340ms' }}>
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password" className="text-sm font-medium text-content-primary">{t('auth.password', 'Password')}</label>
                  <Link to="/forgot-password" className="text-xs font-medium text-oe-blue hover:text-oe-blue-hover transition-colors">{t('auth.forgot_password', 'Forgot password?')}</Link>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-content-tertiary"><Lock size={16} /></div>
                  <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.password_placeholder', 'Enter your password')} autoComplete="current-password" required aria-required="true" minLength={8} className="h-11 w-full rounded-lg border border-border bg-surface-primary pl-10 pr-10 text-base text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('auth.hide_password', 'Hide password') : t('auth.show_password', 'Show password')} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-content-tertiary hover:text-content-secondary transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="animate-stagger-in" style={{ animationDelay: '380ms' }}>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4 rounded border-border text-oe-blue focus:ring-oe-blue accent-oe-blue" />
                  <span className="text-sm text-content-secondary">{t('auth.remember_me', 'Remember me for 30 days')}</span>
                </label>
              </div>

              {error && (
                <div
                  data-testid="login-error"
                  className="flex items-start gap-2 rounded-lg bg-semantic-error-bg px-3.5 py-2.5 text-sm text-semantic-error animate-stagger-in"
                >
                  <span className="shrink-0 mt-0.5">!</span><span>{error}</span>
                </div>
              )}

              <div className="animate-stagger-in" style={{ animationDelay: '400ms' }}>
                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full btn-shimmer">{t('auth.login', 'Sign in')}</Button>
              </div>
            </form>

            {frappeSsoEnabled && (
              <div className="mt-4 animate-stagger-in" style={{ animationDelay: '420ms' }}>
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-border-light" aria-hidden />
                  <span className="text-2xs text-content-tertiary">{t('auth.or', { defaultValue: 'or' })}</span>
                  <span className="h-px flex-1 bg-border-light" aria-hidden />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = `/api/v1/sso/frappe/start/?next=${encodeURIComponent(nextPath)}`;
                  }}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-primary text-sm font-medium text-content-primary transition-all duration-fast ease-oe hover:border-content-tertiary hover:bg-surface-secondary"
                >
                  <svg width="18" height="18" viewBox="0 0 400 400" fill="none" aria-hidden="true" className="shrink-0">
                    <rect width="400" height="400" rx="88" fill="#1a1a1a" />
                    <rect x="142" y="98" width="132" height="40" fill="#fff" />
                    <path d="M142 190h132v40H182v112h-40V190z" fill="#fff" />
                  </svg>
                  {t('auth.sign_in_with_frappe', { defaultValue: 'Sign in with Frappe' })}
                </button>
              </div>
            )}

            <div className="mt-5 border-t border-border-light pt-4 animate-stagger-in" style={{ animationDelay: '460ms' }}>
              <p className="text-center text-sm text-content-secondary">
                {t('auth.no_account', "Don't have an account?")}{' '}
                <Link to="/register" className="font-medium text-oe-blue hover:text-oe-blue-hover transition-colors">{t('auth.create_account', 'Create account')}</Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── About modal ── */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" onClick={() => setShowInfo(false)} />

          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border-light bg-surface-elevated shadow-2xl">
            <button aria-label={t('common.close', { defaultValue: 'Close' })}
              onClick={() => setShowInfo(false)}
              className="sticky top-0 float-right m-3 p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-secondary transition-colors z-10 bg-surface-elevated/80 backdrop-blur-sm"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-border-light clear-both">
              <LogoWithText size="sm" className="mb-3" />
              <h3 className="text-base font-bold text-content-primary mb-2">
                {t('about.title', 'Professional construction cost estimation - free and open source')}
              </h3>
              <p className="text-[13px] text-content-secondary leading-relaxed">
                {t('about.intro', 'OpenConstructionERP is a modern platform for construction cost management. It covers the full estimation workflow - from creating a bill of quantities to tendering and bid comparison. Designed for professionals worldwide, it supports international standards and works in 24 languages.')}
              </p>
              <p className="mt-2 text-[13px] text-content-secondary leading-relaxed">
                {t('about.intro2', 'Unlike traditional commercial solutions, OpenConstructionERP runs entirely on your computer. Your project data never leaves your machine - you have full ownership and control. The source code is open and auditable, so you always know exactly what the software does.')}
              </p>
            </div>

            {/* What you can do */}
            <div className="px-6 py-4">
              <h3 className="text-sm font-semibold text-content-primary mb-3">
                {t('about.capabilities_title', 'What you can do')}
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { icon: FileSpreadsheet, color: 'text-emerald-500 bg-emerald-500/10', title: t('about.cap.boq', 'Bill of Quantities'), desc: t('about.cap.boq_desc', 'Create detailed BOQ with hierarchical sections, positions, assemblies, markups (overhead, profit, VAT), and automatic totals. Works with regional classification systems or your own custom schema.') },
                  { icon: Database, color: 'text-blue-500 bg-blue-500/10', title: t('about.cap.costs', 'Cost Databases'), desc: t('about.cap.costs_desc', '55,000+ cost items across 48 regional databases worldwide. Add your own rates, import from Excel, or build a custom database from scratch.') },
                  { icon: CalendarClock, color: 'text-amber-500 bg-amber-500/10', title: t('about.cap.schedule', '4D Scheduling'), desc: t('about.cap.schedule_desc', 'Create project schedules with CPM critical path calculation, interactive Gantt charts, Monte Carlo risk analysis, resource assignment, and auto-generation of activities from your BOQ.') },
                  { icon: TrendingUp, color: 'text-violet-500 bg-violet-500/10', title: t('about.cap.costmodel', '5D Cost Model'), desc: t('about.cap.costmodel_desc', 'Track budgets over time with Earned Value Management (SPI, CPI), S-curve visualization, cash flow projections, cost snapshots, and what-if scenario modeling for informed decision-making.') },
                  { icon: Boxes, color: 'text-rose-500 bg-rose-500/10', title: t('about.cap.catalog', 'Resource Catalog'), desc: t('about.cap.catalog_desc', '7,000+ resources - materials, equipment, labor, operators, and utilities. Build reusable assemblies (composite rates) from catalog items and apply them directly to BOQ positions.') },
                  { icon: BarChart3, color: 'text-cyan-500 bg-cyan-500/10', title: t('about.cap.tendering', 'Tendering & Bids'), desc: t('about.cap.tendering_desc', 'Create tender packages with scope and positions, distribute to subcontractors, collect and compare bids side-by-side in a price mirror, and make award decisions based on data.') },
                  { icon: Upload, color: 'text-orange-500 bg-orange-500/10', title: t('about.cap.import', 'Import & Export'), desc: t('about.cap.import_desc', 'Full support for GAEB XML (X83), Excel, and CSV import/export. Generate professional PDF reports. Seamlessly integrate with your existing tools and workflows.') },
                  { icon: FileCheck, color: 'text-teal-500 bg-teal-500/10', title: t('about.cap.validation', 'Quality Validation'), desc: t('about.cap.validation_desc', 'Built-in quality engine automatically checks for missing quantities, zero prices, duplicate positions, classification compliance, and rate anomalies - with a traffic-light dashboard.') },
                ].map((cap, idx) => {
                  const Icon = cap.icon;
                  return (
                    <div key={idx} className="rounded-lg border border-border-light/60 bg-surface-secondary/50 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cap.color}`}>
                          <Icon size={13} />
                        </div>
                        <span className="text-xs font-semibold text-content-primary">{cap.title}</span>
                      </div>
                      <p className="text-2xs text-content-tertiary leading-relaxed pl-8">{cap.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Why open source */}
            <div className="px-6 py-4 border-t border-border-light">
              <h3 className="text-sm font-semibold text-content-primary mb-2">
                {t('about.why_title', 'Why open source matters')}
              </h3>
              <div className="space-y-2 text-[13px] text-content-secondary leading-relaxed">
                <p>{t('about.why_1', 'Construction cost data is one of the most valuable assets a company owns. With proprietary software, your data is often locked inside formats you cannot control. If the vendor raises prices, changes terms, or discontinues the product - you may lose access to years of work.')}</p>
                <p>{t('about.why_2', 'OpenConstructionERP takes a different approach. Your data is stored in open formats (SQLite, JSON, CSV) on your own hardware. You can export everything at any time. The source code is publicly auditable under AGPL-3.0, so there are no hidden data transfers, no telemetry, and no surprises.')}</p>
                <p>{t('about.why_3', 'The platform is modular - install only what you need. Community modules extend functionality without bloating the core. And because it runs locally, it works offline and performs fast even with large projects.')}</p>
              </div>
            </div>

            {/* Who is it for */}
            <div className="px-6 py-4 border-t border-border-light">
              <h3 className="text-sm font-semibold text-content-primary mb-2">
                {t('about.who_title', 'Who is it for')}
              </h3>
              <p className="text-[13px] text-content-secondary leading-relaxed mb-3">
                {t('about.who_desc', 'OpenConstructionERP is designed for anyone involved in construction cost management - whether you work on residential projects or large-scale infrastructure, in-house or as a consultant.')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  t('about.who.estimators', 'Cost estimators'),
                  t('about.who.qsurveyor', 'Quantity surveyors'),
                  t('about.who.pm', 'Project managers'),
                  t('about.who.contractors', 'General contractors'),
                  t('about.who.subs', 'Subcontractors'),
                  t('about.who.architects', 'Architects & engineers'),
                  t('about.who.developers', 'Real estate developers'),
                  t('about.who.public', 'Public sector & municipalities'),
                  t('about.who.students', 'Students & educators'),
                  t('about.who.freelancers', 'Freelance consultants'),
                ].map((role) => (
                  <span key={role} className="inline-flex items-center rounded-full bg-oe-blue/10 px-2.5 py-1 text-2xs font-medium text-oe-blue">
                    {role}
                  </span>
                ))}
              </div>
            </div>

            {/* Key facts */}
            <div className="px-6 py-4 border-t border-border-light">
              <h3 className="text-sm font-semibold text-content-primary mb-3">
                {t('about.numbers_title', 'Platform in numbers')}
              </h3>
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  { value: '120,441', label: t('about.stat.costs', 'Cost items') },
                  { value: '48', label: t('about.stat.regions', 'Regional databases') },
                  { value: String(SUPPORTED_LANGUAGES.length), label: t('about.stat.languages', 'Languages') },
                  { value: '100%', label: t('about.stat.free', 'Free & open source') },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg bg-surface-secondary/50 py-2.5">
                    <div className="text-lg font-bold text-oe-blue">{stat.value}</div>
                    <div className="text-2xs text-content-tertiary">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI note */}
            <div className="px-6 py-4 border-t border-border-light">
              <h3 className="text-sm font-semibold text-content-primary mb-2">
                {t('about.ai_title', 'About AI features')}
              </h3>
              <p className="text-[13px] text-content-secondary leading-relaxed">
                {t('about.ai_desc', 'OpenConstructionERP includes optional AI-powered tools - quick estimation from text descriptions, smart cost suggestions, and BOQ chat assistant. These features require an API key from a provider of your choice (Anthropic, OpenAI, Google). AI is always opt-in: it only activates when you configure it, and you decide what data to send. Without an API key, all other features work fully offline.')}
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border-light flex items-center justify-between">
              <div className="flex items-center gap-3 text-2xs text-content-quaternary">
                <a href="/api/source" target="_blank" rel="noopener noreferrer" className="hover:text-content-secondary transition-colors">AGPL-3.0</a>
                <a href="https://OpenConstructionERP.com" target="_blank" rel="noopener noreferrer" className="hover:text-content-secondary transition-colors">OpenConstructionERP.com</a>
                <a href="https://github.com/datadrivenconstruction/OpenConstructionERP" target="_blank" rel="noopener noreferrer" className="hover:text-content-secondary transition-colors">GitHub</a>
              </div>
              <Button variant="primary" size="sm" onClick={() => setShowInfo(false)}>
                {t('about.close', 'Got it')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
