// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { apiGet, apiPost, apiPut } from '@/shared/lib/api';

export interface FrappeSsoConfig {
  id: string;
  enabled: boolean;
  base_url: string;
  client_id: string;
  client_secret_set: boolean;
  redirect_uri: string;
  scope: string;
  allowlist: string;
  /** Authoritative "will the login button actually work" flag. */
  configured: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface FrappeSsoConfigUpdate {
  enabled?: boolean;
  base_url?: string;
  client_id?: string;
  /** Omit to keep the currently stored secret; empty string clears it. */
  client_secret?: string;
  redirect_uri?: string;
  scope?: string;
  allowlist?: string;
}

export interface FrappeSsoTestResult {
  success: boolean;
  message: string;
}

export const ssoApi = {
  getFrappeConfig: () => apiGet<FrappeSsoConfig>('/v1/sso/frappe/config/'),

  updateFrappeConfig: (data: FrappeSsoConfigUpdate) =>
    apiPut<FrappeSsoConfig, FrappeSsoConfigUpdate>('/v1/sso/frappe/config/', data),

  testFrappeConnection: () => apiPost<FrappeSsoTestResult>('/v1/sso/frappe/config/test/'),
};
