# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""SSO module Pydantic schemas - request/response models."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FrappeSsoConfigUpdate(BaseModel):
    """Update the workspace's "Sign in with Frappe" configuration.

    Every field is optional so a partial save (e.g. just flipping
    ``enabled``) doesn't require resending everything. ``client_secret``
    follows the same masked-input convention as AI provider keys: omitting
    it (``None``) keeps the currently stored secret; sending a new value
    overwrites it; sending an empty string clears it.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    enabled: bool | None = None
    base_url: str | None = Field(default=None, max_length=500)
    client_id: str | None = Field(default=None, max_length=255)
    client_secret: str | None = Field(default=None, max_length=1000)
    redirect_uri: str | None = Field(default=None, max_length=500)
    scope: str | None = Field(default=None, max_length=255)
    allowlist: str | None = Field(default=None, max_length=500)


class FrappeSsoConfigResponse(BaseModel):
    """Current "Sign in with Frappe" configuration.

    ``client_secret`` is never returned - only whether one is set (mirrors
    AISettingsResponse's ``*_api_key_set`` flags).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    enabled: bool
    base_url: str
    client_id: str
    client_secret_set: bool = False
    redirect_uri: str
    scope: str
    allowlist: str
    # Authoritative "will the login button actually work" flag, computed
    # server-side from enabled + every required field being present. The
    # frontend's first-run probe surfaces this same computation.
    configured: bool = False
    updated_at: datetime
    updated_by: UUID | None = None


class FrappeSsoTestResult(BaseModel):
    """Result of POST /sso/frappe/config/test/."""

    success: bool
    message: str


class FrappeSsoExchangeRequest(BaseModel):
    """Body of POST /sso/frappe/exchange/ - the single-use handoff code
    minted by the OAuth callback redirect."""

    code: str = Field(..., min_length=1, max_length=4000)
