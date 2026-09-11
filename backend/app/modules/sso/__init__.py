# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Single sign-on module.

Lets an admin configure "Sign in with Frappe" (OAuth2 authorization-code
flow against a self-hosted Frappe site) from within the app - no env vars,
no restart. The Frappe site's URL and OAuth client credentials are stored
in the database (client secret encrypted at rest via app.core.crypto),
mirroring how AI provider API keys are configured in the AI module.
"""
