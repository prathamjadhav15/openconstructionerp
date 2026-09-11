# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
""""Sign in with Frappe" OAuth2 mechanics.

Pure functions - no database access (that's repository.py/service.py). Two
short-lived, single-purpose JWT types are minted here, signed with the app's
own ``jwt_secret`` (the same key every login/refresh/reset token already
uses, per app/modules/users/service.py's house pattern - a new token type is
just another ``type`` claim, not new infrastructure):

- ``sso_state`` - CSRF protection for the authorize round-trip, ~10 min.
- ``sso_handoff`` - single-use, ~60s, carries nothing but a user id. Lets the
  OAuth callback (a page load, not a fetch) hand the browser to the SPA
  without ever putting a real access/refresh token in a redirect URL.

Assumption to verify against the operator's actual Frappe version: the
endpoint paths below (``frappe.integrations.oauth2.{authorize,get_token,
openid_profile}``) and the userinfo claim names (``sub``/``email``/``name``)
have drifted across Frappe releases.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt

from app.core.crypto import decrypt_secret
from app.core.url_safety import UnsafeUrlError, resolve_and_validate_ai_provider_url
from app.modules.sso.models import FrappeSsoConfig

_ALGORITHM = "HS256"
_STATE_EXPIRE_MINUTES = 10
_HANDOFF_EXPIRE_SECONDS = 60
_HTTP_TIMEOUT = 15.0


class FrappeSsoError(Exception):
    """``.code`` is a stable string; the router turns it into the frontend's
    ``sso_error`` query-param value."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class FrappeUserInfo:
    subject: str
    email: str
    full_name: str


def allowlist_hosts(config: FrappeSsoConfig) -> list[str]:
    return [h.strip() for h in (config.allowlist or "").split(",") if h.strip()]


def is_configured(config: FrappeSsoConfig | None) -> bool:
    """True only when the admin switch is on AND every required field is set."""
    return bool(
        config
        and config.enabled
        and config.base_url
        and config.client_id
        and config.client_secret
        and config.redirect_uri
    )


# ── State token (CSRF) ──────────────────────────────────────────────────────


def create_state_token(jwt_secret: str, *, next_path: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "iss": "openconstructionerp",
        "type": "sso_state",
        "next": next_path,
        "iat": now,
        "exp": now + timedelta(minutes=_STATE_EXPIRE_MINUTES),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, jwt_secret, algorithm=_ALGORITHM)


def decode_state_token(jwt_secret: str, token: str) -> dict:
    """Returns the decoded payload (``next`` is the field callers want).

    Raises FrappeSsoError("state_expired"/"state_invalid", ...).
    """
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[_ALGORITHM])
    except JWTError as exc:
        code = "state_expired" if "expired" in str(exc).lower() else "state_invalid"
        raise FrappeSsoError(code, f"Invalid SSO state: {exc}") from exc
    if payload.get("type") != "sso_state":
        raise FrappeSsoError("state_invalid", "Wrong token type presented as SSO state")
    return payload


# ── Handoff token (single-use, post-callback → frontend) ───────────────────


class _UsedHandoffTokens:
    """Tracks consumed handoff ``jti``s so a code can be exchanged exactly
    once. In-memory dict + Lock, same shape as core.rate_limiter.RateLimiter
    - this app has no Redis, and a 60s-lifetime, single-process concern
    doesn't need one."""

    def __init__(self) -> None:
        self._used: dict[str, float] = defaultdict(float)  # jti -> expiry epoch
        self._lock = Lock()

    def consume(self, jti: str, expires_at: float) -> bool:
        """Marks *jti* used. Returns False if it was already consumed."""
        now = time.time()
        with self._lock:
            # Prune opportunistically - this dict never holds more than a
            # handful of entries at once given the 60s lifetime.
            expired = [k for k, exp in self._used.items() if exp < now]
            for k in expired:
                del self._used[k]
            if jti in self._used:
                return False
            self._used[jti] = expires_at
            return True


_used_handoff_tokens = _UsedHandoffTokens()


def create_handoff_token(jwt_secret: str, user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "iss": "openconstructionerp",
        "type": "sso_handoff",
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(seconds=_HANDOFF_EXPIRE_SECONDS),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, jwt_secret, algorithm=_ALGORITHM)


def decode_handoff_token(jwt_secret: str, token: str) -> str:
    """Returns the user id carried by *token*.

    Raises FrappeSsoError("handoff_expired"/"handoff_invalid"/
    "handoff_reused", ...).
    """
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[_ALGORITHM])
    except JWTError as exc:
        code = "handoff_expired" if "expired" in str(exc).lower() else "handoff_invalid"
        raise FrappeSsoError(code, f"Invalid SSO handoff code: {exc}") from exc
    if payload.get("type") != "sso_handoff":
        raise FrappeSsoError("handoff_invalid", "Wrong token type presented as SSO handoff")
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or not _used_handoff_tokens.consume(jti, float(exp or 0)):
        raise FrappeSsoError("handoff_reused", "SSO handoff code already used")
    user_id = payload.get("sub")
    if not user_id:
        raise FrappeSsoError("handoff_invalid", "SSO handoff code carries no user id")
    return user_id


# ── Frappe OAuth2 endpoints ──────────────────────────────────────────────────


def build_authorize_url(config: FrappeSsoConfig, state: str) -> str:
    params = {
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "response_type": "code",
        "scope": config.scope or "openid",
        "state": state,
    }
    base = config.base_url.rstrip("/")
    return f"{base}/api/method/frappe.integrations.oauth2.authorize?{urlencode(params)}"


async def exchange_code(config: FrappeSsoConfig, code: str) -> str:
    """Exchanges an authorization *code* for a Frappe access token."""
    base = config.base_url.rstrip("/")
    url = f"{base}/api/method/frappe.integrations.oauth2.get_token"
    # config.client_secret is Fernet ciphertext at rest (app.core.crypto) -
    # decrypt only at the moment it's actually needed for this call.
    client_secret = decrypt_secret(config.client_secret)
    if not client_secret:
        raise FrappeSsoError(
            "idp_unreachable",
            "Stored Frappe client secret could not be decrypted (encryption key rotated?)",
        )
    try:
        safe_url = await resolve_and_validate_ai_provider_url(url, allowlist_hosts(config))
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                safe_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": config.redirect_uri,
                    "client_id": config.client_id,
                    "client_secret": client_secret,
                },
            )
    except UnsafeUrlError as exc:
        raise FrappeSsoError("idp_unreachable", f"Frappe base URL blocked: {exc}") from exc
    except httpx.HTTPError as exc:
        raise FrappeSsoError("idp_unreachable", f"Could not reach Frappe: {exc}") from exc

    if resp.status_code != 200:
        raise FrappeSsoError(
            "idp_unreachable", f"Frappe token endpoint returned {resp.status_code}: {resp.text[:200]}"
        )
    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise FrappeSsoError("idp_unreachable", "Frappe token endpoint returned no access_token")
    return access_token


async def fetch_userinfo(config: FrappeSsoConfig, frappe_access_token: str) -> FrappeUserInfo:
    """Fetches the authenticated Frappe user's identity."""
    base = config.base_url.rstrip("/")
    url = f"{base}/api/method/frappe.integrations.oauth2.openid_profile"
    try:
        safe_url = await resolve_and_validate_ai_provider_url(url, allowlist_hosts(config))
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(safe_url, headers={"Authorization": f"Bearer {frappe_access_token}"})
    except UnsafeUrlError as exc:
        raise FrappeSsoError("idp_unreachable", f"Frappe base URL blocked: {exc}") from exc
    except httpx.HTTPError as exc:
        raise FrappeSsoError("idp_unreachable", f"Could not reach Frappe: {exc}") from exc

    if resp.status_code != 200:
        raise FrappeSsoError(
            "idp_unreachable", f"Frappe userinfo endpoint returned {resp.status_code}: {resp.text[:200]}"
        )
    data = resp.json()
    email = (data.get("email") or "").strip().lower()
    full_name = (data.get("name") or data.get("full_name") or "").strip()
    subject = str(data.get("sub") or email)
    if not email:
        raise FrappeSsoError("idp_no_email", "Frappe userinfo response has no email claim")
    return FrappeUserInfo(subject=subject, email=email, full_name=full_name)


async def ping(config: FrappeSsoConfig) -> None:
    """Verifies *config.base_url* is reachable and looks like a Frappe site.

    Used by the "Test connection" button. Does NOT validate the OAuth
    client id/secret - there is no generic way to do that without a real
    authorization-code round trip, so credentials are only fully verified
    the first time someone actually signs in.
    """
    base = config.base_url.rstrip("/")
    url = f"{base}/api/method/ping"
    try:
        safe_url = await resolve_and_validate_ai_provider_url(url, allowlist_hosts(config))
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(safe_url)
    except UnsafeUrlError as exc:
        raise FrappeSsoError("idp_unreachable", f"Base URL blocked: {exc}") from exc
    except httpx.HTTPError as exc:
        raise FrappeSsoError("idp_unreachable", f"Could not reach {config.base_url}: {exc}") from exc
    if resp.status_code != 200:
        raise FrappeSsoError("idp_unreachable", f"Site responded with HTTP {resp.status_code}, expected 200")
