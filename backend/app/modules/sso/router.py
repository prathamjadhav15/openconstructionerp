# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""SSO API routes.

Endpoints:
    GET    /sso/frappe/config/       - Get Frappe SSO config (admin)
    PUT    /sso/frappe/config/       - Update Frappe SSO config (admin)
    POST   /sso/frappe/config/test/  - Verify the Frappe site is reachable (admin)
    GET    /sso/frappe/start/        - Begin "Sign in with Frappe" (public)
    GET    /sso/frappe/callback/     - Frappe OAuth2 redirect target (public)
    POST   /sso/frappe/exchange/     - Exchange a handoff code for real tokens (public)

The config endpoints are gated with RequireRole("admin") - simplest, most
decisive gate available for something this close to an auth-bypass surface
(mirrors app/core/branding_router.py's admin-only write gate, extended here
to reads too since even client_id/base_url are operational secrets for auth
infrastructure, unlike branding's public logo).

The three OAuth-flow endpoints are public by necessity - the person hitting
them isn't signed in yet - and rate-limited per IP via the same
``login_limiter`` every other login path already shares.
"""

import logging
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from app.core.rate_limiter import client_identifier, login_limiter
from app.dependencies import CurrentUserId, RequireRole, SessionDep, SettingsDep
from app.modules.sso import oauth
from app.modules.sso.repository import FrappeSsoConfigRepository
from app.modules.sso.schemas import (
    FrappeSsoConfigResponse,
    FrappeSsoConfigUpdate,
    FrappeSsoExchangeRequest,
    FrappeSsoTestResult,
)
from app.modules.sso.service import FrappeSsoService
from app.modules.users.schemas import TokenResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sso"])


def _get_service(session: SessionDep) -> FrappeSsoService:
    return FrappeSsoService(session)


def _error_redirect(settings: SettingsDep, code: str) -> RedirectResponse:
    base = settings.resolved_frontend_url.rstrip("/")
    return RedirectResponse(f"{base}/login?sso_error={code}", status_code=status.HTTP_302_FOUND)


# ── Admin config ─────────────────────────────────────────────────────────


@router.get(
    "/frappe/config/",
    response_model=FrappeSsoConfigResponse,
    dependencies=[Depends(RequireRole("admin"))],
)
@router.get(
    "/frappe/config",
    response_model=FrappeSsoConfigResponse,
    include_in_schema=False,
    dependencies=[Depends(RequireRole("admin"))],
)
async def get_frappe_sso_config(
    service: FrappeSsoService = Depends(_get_service),
) -> FrappeSsoConfigResponse:
    """Current "Sign in with Frappe" configuration. Admin only."""
    return await service.get_config()


@router.put(
    "/frappe/config/",
    response_model=FrappeSsoConfigResponse,
    dependencies=[Depends(RequireRole("admin"))],
)
@router.put(
    "/frappe/config",
    response_model=FrappeSsoConfigResponse,
    include_in_schema=False,
    dependencies=[Depends(RequireRole("admin"))],
)
async def update_frappe_sso_config(
    data: FrappeSsoConfigUpdate,
    user_id: CurrentUserId,
    service: FrappeSsoService = Depends(_get_service),
) -> FrappeSsoConfigResponse:
    """Update the workspace's Frappe SSO config. Admin only.

    ``client_secret`` omitted keeps the currently stored secret; an empty
    string clears it; any other value overwrites it (encrypted at rest).
    """
    return await service.update_config(data, admin_user_id=user_id)


@router.post(
    "/frappe/config/test/",
    response_model=FrappeSsoTestResult,
    dependencies=[Depends(RequireRole("admin"))],
)
@router.post(
    "/frappe/config/test",
    response_model=FrappeSsoTestResult,
    include_in_schema=False,
    dependencies=[Depends(RequireRole("admin"))],
)
async def test_frappe_sso_config(
    service: FrappeSsoService = Depends(_get_service),
) -> FrappeSsoTestResult:
    """Verify the saved Frappe base URL is reachable. Admin only.

    Does not validate the OAuth client id/secret - there is no generic way
    to do that without a real authorization-code round trip, so credentials
    are only fully verified the first time someone actually signs in.
    """
    return await service.test_connection()


# ── OAuth flow (public - the visitor isn't signed in yet) ──────────────────


@router.get("/frappe/start/")
@router.get("/frappe/start", include_in_schema=False)
async def frappe_sso_start(
    settings: SettingsDep,
    session: SessionDep,
    next: str = "/",
) -> RedirectResponse:
    """Begin the "Sign in with Frappe" flow - redirects to Frappe's
    authorize page, or back to /login?sso_error=not_configured if the admin
    hasn't finished setup (defense-in-depth; the button should already be
    hidden in that case)."""
    config = await FrappeSsoConfigRepository(session).get()
    if not oauth.is_configured(config):
        return _error_redirect(settings, "not_configured")
    state = oauth.create_state_token(settings.jwt_secret, next_path=next)
    return RedirectResponse(oauth.build_authorize_url(config, state), status_code=status.HTTP_302_FOUND)


@router.get("/frappe/callback/")
@router.get("/frappe/callback", include_in_schema=False)
async def frappe_sso_callback(
    request: Request,
    settings: SettingsDep,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Frappe's OAuth2 redirect target.

    Never returns real tokens in this redirect - mints a single-use, 60s
    handoff code instead, and sends the browser to the SPA's
    ``/auth/sso/callback`` route, which exchanges it for the real
    TokenResponse via one more POST (see frappe_sso_exchange below).
    """
    client_ip = client_identifier(request)
    allowed, _remaining = login_limiter.is_allowed(f"sso_{client_ip}")
    if not allowed:
        return _error_redirect(settings, "rate_limited")

    if error:
        return _error_redirect(settings, "denied")
    if not code or not state:
        return _error_redirect(settings, "missing_params")

    config = await FrappeSsoConfigRepository(session).get()
    if not oauth.is_configured(config):
        return _error_redirect(settings, "not_configured")

    try:
        state_payload = oauth.decode_state_token(settings.jwt_secret, state)
        next_path = state_payload.get("next") or "/"
        frappe_access_token = await oauth.exchange_code(config, code)
        userinfo = await oauth.fetch_userinfo(config, frappe_access_token)
    except oauth.FrappeSsoError as exc:
        logger.warning("Frappe SSO callback failed (%s): %s", exc.code, exc.message)
        return _error_redirect(settings, exc.code)

    from app.modules.users.service import UserService

    user_service = UserService(session, settings)
    try:
        user = await user_service.find_or_provision_frappe_user(userinfo)
    except HTTPException as exc:
        # find_or_provision_frappe_user raises with detail already set to one
        # of this module's sso_error codes verbatim - no re-mapping needed.
        return _error_redirect(settings, str(exc.detail))

    handoff = oauth.create_handoff_token(settings.jwt_secret, str(user.id))
    base = settings.resolved_frontend_url.rstrip("/")
    return RedirectResponse(
        f"{base}/auth/sso/callback?code={handoff}&next={quote(next_path, safe='')}",
        status_code=status.HTTP_302_FOUND,
    )


@router.post("/frappe/exchange/", response_model=TokenResponse)
@router.post("/frappe/exchange", response_model=TokenResponse, include_in_schema=False)
async def frappe_sso_exchange(
    data: FrappeSsoExchangeRequest,
    request: Request,
    settings: SettingsDep,
    session: SessionDep,
) -> TokenResponse:
    """Exchanges a single-use handoff code for the real access/refresh
    tokens. This is the only place in the whole Frappe SSO flow that mints
    real tokens, via the same ``_issue_token_pair`` choke point every other
    login path (password, demo) already goes through."""
    client_ip = client_identifier(request)
    allowed, _remaining = login_limiter.is_allowed(f"sso_exchange_{client_ip}")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate_limited",
            headers={"Retry-After": "60"},
        )

    try:
        user_id = oauth.decode_handoff_token(settings.jwt_secret, data.code)
    except oauth.FrappeSsoError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.code) from exc

    from app.modules.users.repository import UserRepository
    from app.modules.users.service import UserService

    user = await UserRepository(session).get_by_id(uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account_inactive")

    user_service = UserService(session, settings)
    # _issue_token_pair is "private" (leading underscore) by convention, not
    # by Python enforcement - reusing it here is deliberate: it is the one
    # choke point every login path must go through so every token pair stays
    # tied to a revocable UserSession row (see users/service.py's own
    # comments on this method).
    return await user_service._issue_token_pair(user)  # noqa: SLF001
