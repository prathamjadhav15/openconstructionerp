# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""SSO module business logic - Frappe config CRUD + connection test.

Config is read straight from the database on every call, deliberately with
no process-wide cache: a previous cached-config version of the (structurally
similar) AI settings module leaked one user's self-hosted endpoint into
another user's request (GHSA-wfpw-cv5v-64j5). A security-sensitive OAuth
config gets the same no-cache treatment.
"""

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret, encrypt_secret
from app.modules.sso import oauth
from app.modules.sso.models import FrappeSsoConfig
from app.modules.sso.repository import FrappeSsoConfigRepository
from app.modules.sso.schemas import (
    FrappeSsoConfigResponse,
    FrappeSsoConfigUpdate,
    FrappeSsoTestResult,
)

logger = logging.getLogger(__name__)


def _build_config_response(config: FrappeSsoConfig) -> FrappeSsoConfigResponse:
    return FrappeSsoConfigResponse(
        id=config.id,
        enabled=config.enabled,
        base_url=config.base_url,
        client_id=config.client_id,
        client_secret_set=bool(decrypt_secret(config.client_secret)) if config.client_secret else False,
        redirect_uri=config.redirect_uri,
        scope=config.scope,
        allowlist=config.allowlist,
        configured=oauth.is_configured(config),
        updated_at=config.updated_at,
        updated_by=config.updated_by,
    )


_EMPTY_RESPONSE_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "base_url": "",
    "client_id": "",
    "client_secret_set": False,
    "redirect_uri": "",
    "scope": "openid",
    "allowlist": "",
    "configured": False,
}


async def is_frappe_sso_enabled(session: AsyncSession) -> bool:
    """Cross-module helper for UserService.first_run_status - fresh DB read,
    no cache, safe to call from a public unauthenticated endpoint."""
    config = await FrappeSsoConfigRepository(session).get()
    return oauth.is_configured(config)


class FrappeSsoService:
    """Business logic for the "Sign in with Frappe" config + connection test."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.config_repo = FrappeSsoConfigRepository(session)

    async def get_config(self) -> FrappeSsoConfigResponse:
        config = await self.config_repo.get()
        if config is None:
            # No row yet - report the all-false default rather than 404, so
            # the Settings page can render an empty form on first visit.
            import uuid as _uuid
            from datetime import UTC, datetime

            return FrappeSsoConfigResponse(
                id=_uuid.UUID(int=0),
                updated_at=datetime.now(UTC),
                updated_by=None,
                **_EMPTY_RESPONSE_DEFAULTS,
            )
        return _build_config_response(config)

    async def update_config(self, data: FrappeSsoConfigUpdate, *, admin_user_id: str) -> FrappeSsoConfigResponse:
        config = await self.config_repo.get()
        updated_by = uuid.UUID(admin_user_id)

        if config is None:
            create_kwargs: dict[str, Any] = {"updated_by": updated_by}
            if data.enabled is not None:
                create_kwargs["enabled"] = data.enabled
            if data.base_url is not None:
                create_kwargs["base_url"] = data.base_url
            if data.client_id is not None:
                create_kwargs["client_id"] = data.client_id
            if data.client_secret is not None:
                create_kwargs["client_secret"] = encrypt_secret(data.client_secret)
            if data.redirect_uri is not None:
                create_kwargs["redirect_uri"] = data.redirect_uri
            if data.scope is not None:
                create_kwargs["scope"] = data.scope
            if data.allowlist is not None:
                create_kwargs["allowlist"] = data.allowlist
            config = await self.config_repo.create(FrappeSsoConfig(**create_kwargs))
            logger.info("Frappe SSO config created by admin %s", admin_user_id)
            return _build_config_response(config)

        fields: dict[str, Any] = {"updated_by": updated_by}
        if data.enabled is not None:
            fields["enabled"] = data.enabled
        if data.base_url is not None:
            fields["base_url"] = data.base_url
        if data.client_id is not None:
            fields["client_id"] = data.client_id
        if data.client_secret is not None:
            # Empty string clears the secret (encrypt_secret passes "" through
            # unchanged - see app/core/crypto.py), same convention as AI keys.
            fields["client_secret"] = encrypt_secret(data.client_secret)
        if data.redirect_uri is not None:
            fields["redirect_uri"] = data.redirect_uri
        if data.scope is not None:
            fields["scope"] = data.scope
        if data.allowlist is not None:
            fields["allowlist"] = data.allowlist

        await self.config_repo.update_fields(config.id, **fields)
        config = await self.config_repo.get()
        logger.info("Frappe SSO config updated by admin %s", admin_user_id)
        return _build_config_response(config)  # type: ignore[arg-type]

    async def test_connection(self) -> FrappeSsoTestResult:
        config = await self.config_repo.get()
        if config is None or not config.base_url:
            return FrappeSsoTestResult(success=False, message="Set a Frappe base URL first.")
        try:
            await oauth.ping(config)
        except oauth.FrappeSsoError as exc:
            return FrappeSsoTestResult(success=False, message=exc.message)
        return FrappeSsoTestResult(
            success=True,
            message="Frappe site is reachable. OAuth credentials are only fully verified on first sign-in.",
        )
