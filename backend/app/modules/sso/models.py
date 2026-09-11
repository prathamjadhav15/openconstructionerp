# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Single sign-on ORM models.

Tables:
    oe_sso_frappe_config - workspace-wide "Sign in with Frappe" configuration
"""

import uuid

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import GUID, Base


class FrappeSsoConfig(Base):
    """Workspace-wide Frappe OAuth2 configuration.

    Single-tenant, single-row table - this app has one workspace, so there is
    exactly one config, not one per user (unlike ``AISettings``). The
    repository enforces "at most one row" by always reading/updating the
    first row it finds rather than keying off a caller-supplied id.
    """

    __tablename__ = "oe_sso_frappe_config"

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    client_id: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Fernet ciphertext (app.core.crypto.encrypt_secret) - never returned to
    # the frontend; the API only ever reports client_secret_set: bool.
    client_secret: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)
    redirect_uri: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(255), nullable=False, default="openid")
    # Comma-separated hostnames/CIDRs, mirrors Settings.ai_provider_allowlist.
    allowlist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Admin who last saved this config, for audit. Nullable: the row may be
    # created by a migration/seed with no attributable user.
    updated_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, default=None)

    def __repr__(self) -> str:
        return f"<FrappeSsoConfig enabled={self.enabled} base_url={self.base_url!r}>"
