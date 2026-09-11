# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Frappe SSO config table (v3320).

Adds ``oe_sso_frappe_config`` - the workspace-wide "Sign in with Frappe"
configuration (base URL, OAuth client id/secret, redirect URI, scope,
allowlist). Single-tenant, single-row table: this app has one workspace,
so there is at most one row, not one per user.

``client_secret`` is stored as Fernet ciphertext (app.core.crypto) - this
migration only creates the column, it does not touch its contents.

Idempotent - guarded so a re-run on a partially-migrated DB is a no-op.
Safe on both the SQLite dev DB (``GUID()`` as ``VARCHAR(36)``) and the
Postgres prod DB (native ``UUID``).

Revision ID: v3320_frappe_sso_config
Revises: v3319_project_country_code_nullable
Create Date: 2026-09-10
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "v3320_frappe_sso_config"
down_revision: Union[str, Sequence[str], None] = "v3319_project_country_code_nullable"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "oe_sso_frappe_config"


def _has_table(inspector: sa.engine.reflection.Inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    guid_type = sa.String(36) if is_sqlite else sa.dialects.postgresql.UUID(as_uuid=True)
    inspector = sa.inspect(bind)

    if _has_table(inspector, _TABLE):
        return

    op.create_table(
        _TABLE,
        sa.Column("id", guid_type, primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("base_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("client_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("client_secret", sa.String(1000), nullable=True),
        sa.Column("redirect_uri", sa.String(500), nullable=False, server_default=""),
        sa.Column("scope", sa.String(255), nullable=False, server_default="openid"),
        sa.Column("allowlist", sa.String(500), nullable=False, server_default=""),
        sa.Column("updated_by", guid_type, nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_table(inspector, _TABLE):
        op.drop_table(_TABLE)
