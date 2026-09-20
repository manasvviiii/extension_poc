from __future__ import annotations

import hmac
import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import Header, HTTPException

from .context import AuthContext, CURRENT_CONTEXT, compatibility_context
from .audit import security_audit


@dataclass
class AuthSettings:
    mode: str = "compatibility"
    dev_auth_token: str | None = None
    dev_owner_id: str | None = None
    dev_tokens: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "AuthSettings":
        raw_tokens = os.getenv("DEV_AUTH_TOKENS", "{}")
        try:
            tokens = json.loads(raw_tokens)
        except json.JSONDecodeError as error:
            raise RuntimeError("DEV_AUTH_TOKENS must be valid JSON") from error
        if not isinstance(tokens, dict):
            raise RuntimeError("DEV_AUTH_TOKENS must be a JSON object")
        return cls(
            mode=os.getenv("AUTH_MODE", "compatibility").casefold(),
            dev_auth_token=os.getenv("DEV_AUTH_TOKEN") or None,
            dev_owner_id=os.getenv("DEV_OWNER_ID") or None,
            dev_tokens=tokens,
        )


settings = AuthSettings.from_env()


def configure_settings(new_settings: AuthSettings) -> None:
    global settings
    settings = new_settings


def _context_from_claims(claims: dict[str, Any]) -> AuthContext:
    owner_id = claims.get("owner_id")
    if not owner_id:
        raise HTTPException(status_code=401, detail="Authentication context is incomplete")
    try:
        user_id = uuid.UUID(str(claims.get("user_id")))
        tenant_id = uuid.UUID(str(claims.get("tenant_id")))
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(status_code=401, detail="Authentication context is invalid") from error
    roles = claims.get("roles", ["member"])
    if not isinstance(roles, list) or not all(isinstance(role, str) for role in roles):
        raise HTTPException(status_code=401, detail="Authentication roles are invalid")
    return AuthContext(
        user_id=user_id,
        tenant_id=tenant_id,
        owner_id=str(owner_id),
        roles=tuple(roles),
        authenticated=True,
    )


def _development_context(token: str | None) -> AuthContext:
    if not token:
        security_audit("authentication_failure", "denied", {"reason": "missing_token"})
        raise HTTPException(status_code=401, detail="Development authentication required")

    candidates: list[tuple[str, dict[str, Any]]] = []
    if settings.dev_auth_token and settings.dev_owner_id:
        candidates.append((settings.dev_auth_token, {
            "owner_id": settings.dev_owner_id,
            "user_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"user:{settings.dev_owner_id}")),
            "tenant_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenant:{settings.dev_owner_id}")),
            "roles": ["admin"],
        }))
    candidates.extend(
        (configured_token, claims)
        for configured_token, claims in settings.dev_tokens.items()
    )

    for configured_token, claims in candidates:
        if hmac.compare_digest(token, configured_token):
            return _context_from_claims(claims)
    security_audit("authentication_failure", "denied", {"reason": "invalid_token"})
    raise HTTPException(status_code=401, detail="Invalid development credentials")


def get_auth_context(
    x_warmgraph_dev_token: str | None = Header(default=None),
) -> AuthContext:
    mode = settings.mode
    if mode == "compatibility":
        # Route handlers validate owner_id against authenticated contexts when
        # development auth is enabled. This mode exists only for the old MVP.
        context = AuthContext(
            user_id=uuid.UUID(int=0),
            tenant_id=uuid.UUID(int=0),
            owner_id=None,
            roles=("admin",),
            authenticated=False,
        )
        CURRENT_CONTEXT.set(context)
        return context
    if mode == "development":
        context = _development_context(x_warmgraph_dev_token)
        CURRENT_CONTEXT.set(context)
        return context
    if mode in {"oidc", "jwt"}:
        raise HTTPException(status_code=501, detail="Production identity integration is not configured")
    if mode == "disabled":
        security_audit("authentication_failure", "denied", {"reason": "development_auth_disabled"})
        raise HTTPException(status_code=401, detail="Authentication is disabled")
    raise HTTPException(status_code=503, detail="Unsupported authentication mode")


def context_or_compatibility(value: object, owner_id: str) -> AuthContext:
    if isinstance(value, AuthContext):
        return value
    return compatibility_context(owner_id)
