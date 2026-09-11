# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""SSO module data access layer.

No business logic - pure data access, mirrors app/modules/ai/repository.py.
"""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.orm.util import identity_key
from sqlalchemy.sql.elements import ClauseElement

from app.modules.sso.models import FrappeSsoConfig


class FrappeSsoConfigRepository:
    """Data access for the singleton FrappeSsoConfig row."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self) -> FrappeSsoConfig | None:
        """Return the (only) config row, or None if never configured."""
        stmt = select(FrappeSsoConfig).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, config: FrappeSsoConfig) -> FrappeSsoConfig:
        self.session.add(config)
        await self.session.flush()
        return config

    async def update_fields(self, config_id: uuid.UUID, **fields: object) -> None:
        """Update specific fields on the config row. Mirrors
        AISettingsRepository.update_fields exactly (same identity-map
        refresh trick, same handling for SQL-expression values)."""
        stmt = update(FrappeSsoConfig).where(FrappeSsoConfig.id == config_id).values(**fields)
        await self.session.execute(stmt)
        await self.session.flush()
        instance = self.session.identity_map.get(identity_key(FrappeSsoConfig, config_id))
        if instance is None:
            return
        computed = [name for name, value in fields.items() if isinstance(value, ClauseElement)]
        for name, value in fields.items():
            if name not in computed:
                set_committed_value(instance, name, value)
        if computed:
            self.session.expire(instance, computed)
