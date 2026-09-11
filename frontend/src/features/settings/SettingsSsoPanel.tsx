// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Settings -> Single Sign-On panel.
 *
 * Lets an admin configure "Sign in with Frappe" from inside the app - no
 * env vars, no restart (see backend app/modules/sso). Modeled on the AI
 * provider settings panel in this same feature: a masked-secret input that
 * only overwrites the stored value when retyped, and a "Test connection"
 * button that verifies reachability immediately rather than waiting for a
 * real sign-in attempt to reveal a typo.
 *
 * The backend's config endpoints are RequireRole("admin"); this panel
 * doesn't even issue the GET for a non-admin, since that would just 403.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { Card, CardHeader, CardContent, CardFooter, Button, Badge, InfoHint, Skeleton } from '@/shared/ui';
import { useAuthStore } from '@/stores/useAuthStore';
import { useToastStore } from '@/stores/useToastStore';
import { ssoApi, type FrappeSsoConfigUpdate } from '@/features/sso/api';

export function SettingsSsoPanel() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.userRole);
  const isAdmin = role === 'admin';
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const { data: config, isLoading } = useQuery({
    queryKey: ['sso', 'frappe-config'],
    queryFn: ssoApi.getFrappeConfig,
    enabled: isAdmin,
  });

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scope, setScope] = useState('openid');
  const [allowlist, setAllowlist] = useState('');

  // Seed the form from the server once loaded. Deliberately not re-run on
  // every refetch (no `config` in the deps beyond mount-of-data) so a save
  // in flight doesn't get clobbered by the panel's own invalidated refetch.
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setBaseUrl(config.base_url);
    setClientId(config.client_id);
    setRedirectUri(config.redirect_uri);
    setScope(config.scope || 'openid');
    setAllowlist(config.allowlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.id]);

  const saveMutation = useMutation({
    mutationFn: (data: FrappeSsoConfigUpdate) => ssoApi.updateFrappeConfig(data),
    onSuccess: () => {
      setClientSecret('');
      void queryClient.invalidateQueries({ queryKey: ['sso', 'frappe-config'] });
      addToast({
        type: 'success',
        title: t('settings.sso_saved', { defaultValue: 'Single sign-on settings saved' }),
      });
    },
    onError: () => {
      addToast({
        type: 'error',
        title: t('settings.sso_save_failed', { defaultValue: 'Could not save single sign-on settings' }),
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: ssoApi.testFrappeConnection,
    onSuccess: (result) => {
      addToast({ type: result.success ? 'success' : 'warning', title: result.message });
    },
    onError: () => {
      addToast({
        type: 'error',
        title: t('settings.sso_test_failed', { defaultValue: 'Could not test the connection' }),
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      enabled,
      base_url: baseUrl.trim(),
      client_id: clientId.trim(),
      // Omit entirely when untouched, so the stored secret is kept - only a
      // non-empty retype overwrites it.
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uri: redirectUri.trim(),
      scope: scope.trim() || 'openid',
      allowlist: allowlist.trim(),
    });
  };

  const handleTest = () => {
    // Test reads the already-saved base_url, so persist first if the field
    // was edited - same "save-then-test" UX as the AI provider panel.
    saveMutation.mutate(
      {
        enabled,
        base_url: baseUrl.trim(),
        client_id: clientId.trim(),
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        redirect_uri: redirectUri.trim(),
        scope: scope.trim() || 'openid',
        allowlist: allowlist.trim(),
      },
      { onSuccess: () => testMutation.mutate() },
    );
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader
          title={t('settings.tab_sso', { defaultValue: 'Single Sign-On' })}
          subtitle={t('settings.sso_admin_only', {
            defaultValue: 'Only an administrator can configure single sign-on.',
          })}
        />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound size={16} className="text-content-tertiary" />
            {t('settings.tab_sso', { defaultValue: 'Single Sign-On' })}
          </span>
        }
        subtitle={t('settings.sso_desc', {
          defaultValue: 'Let people sign in with their existing Frappe account instead of a separate password.',
        })}
        action={
          config?.configured ? (
            <Badge variant="success">{t('settings.sso_configured', { defaultValue: 'Configured' })}</Badge>
          ) : (
            <Badge variant="neutral">{t('settings.sso_not_configured', { defaultValue: 'Not configured' })}</Badge>
          )
        }
      />
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border text-oe-blue focus:ring-oe-blue accent-oe-blue"
          />
          <span className="text-sm font-medium text-content-primary">
            {t('settings.sso_enable', { defaultValue: 'Enable "Sign in with Frappe" on the login page' })}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-content-primary">
              {t('settings.sso_base_url', { defaultValue: 'Frappe site URL' })}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-frappe-site.example.com"
              className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-content-primary">
              {t('settings.sso_redirect_uri', { defaultValue: 'Redirect URI' })}
              <InfoHint
                inline
                text={t('settings.sso_redirect_uri_hint', {
                  defaultValue:
                    'Register this exact URL (trailing slash matters) as the OAuth Client\'s redirect URI on your Frappe site.',
                })}
              />
            </label>
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://your-erp-domain.example.com/api/v1/sso/frappe/callback/"
              className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-content-primary">
              {t('settings.sso_client_id', { defaultValue: 'Client ID' })}
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-content-primary">
              {t('settings.sso_client_secret', { defaultValue: 'Client Secret' })}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  config?.client_secret_set
                    ? '••••••••••••••••'
                    : t('settings.sso_client_secret_placeholder', { defaultValue: 'Not set' })
                }
                className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 pr-9 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-content-tertiary hover:text-content-secondary transition-colors"
                tabIndex={-1}
                aria-label={showSecret ? t('auth.hide_password', { defaultValue: 'Hide' }) : t('auth.show_password', { defaultValue: 'Show' })}
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs font-medium text-oe-blue hover:text-oe-blue-hover transition-colors"
        >
          {showAdvanced
            ? t('settings.sso_hide_advanced', { defaultValue: 'Hide advanced' })
            : t('settings.sso_show_advanced', { defaultValue: 'Show advanced' })}
        </button>

        {showAdvanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-content-primary">
                {t('settings.sso_scope', { defaultValue: 'OAuth scope' })}
              </label>
              <input
                type="text"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-content-primary">
                {t('settings.sso_allowlist', { defaultValue: 'Host allowlist (optional)' })}
                <InfoHint
                  inline
                  text={t('settings.sso_allowlist_hint', {
                    defaultValue: 'Comma-separated hostnames/CIDRs. Leave blank to allow the site URL above as-is.',
                  })}
                />
              </label>
              <input
                type="text"
                value={allowlist}
                onChange={(e) => setAllowlist(e.target.value)}
                placeholder="frappe.internal, 10.0.0.0/8"
                className="h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
              />
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={testMutation.isPending || saveMutation.isPending}
          disabled={!baseUrl.trim()}
          onClick={handleTest}
        >
          {t('settings.sso_test', { defaultValue: 'Test connection' })}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saveMutation.isPending} onClick={handleSave}>
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </CardFooter>
    </Card>
  );
}
