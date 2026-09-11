# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Single sign-on module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_sso",
    version="0.1.0",
    display_name="Single Sign-On",
    description="Sign in with an external identity provider (Frappe OAuth2)",
    author="OpenConstructionERP Core Team",
    category="core",
    depends=["oe_users"],
    auto_install=True,
    enabled=True,
)
