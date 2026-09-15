# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""users: add avatar_url (v3321).

Adds ``oe_users_user.avatar_url`` (String(1000), nullable) - the profile
picture URL. Populated from the IdP's OIDC ``picture`` claim on Frappe SSO
login (see app/modules/sso/oauth.py); NULL for a locally-registered account
that has never signed in via SSO.

Strictly additive and nullable, so every existing row reads unchanged and
no backfill is needed.

Idempotent - inspector-guarded so a re-run on a partially-migrated DB skips
the already-present column.

Revision ID: v3321_user_avatar_url
Revises: v3320_frappe_sso_config
Create Date: 2026-09-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "v3321_user_avatar_url"
down_revision: Union[str, Sequence[str], None] = "v3320_frappe_sso_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "oe_users_user"
_COL = "avatar_url"


def _has_table(inspector: sa.engine.reflection.Inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _has_column(inspector: sa.engine.reflection.Inspector, table: str, column: str) -> bool:
    if not _has_table(inspector, table):
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_table(inspector, _TABLE):
        return
    if not _has_column(inspector, _TABLE, _COL):
        op.add_column(_TABLE, sa.Column(_COL, sa.String(length=1000), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, _TABLE, _COL):
        with op.batch_alter_table(_TABLE) as batch_op:
            batch_op.drop_column(_COL)
