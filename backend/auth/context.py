from __future__ import annotations

import uuid
from contextvars import ContextVar

from fastapi import HTTPException

from .audit import security_audit

COMPATIBILITY_NAMESPACE = uuid.UUID("d4bd7e26-6a1e-4b29-9b99-7e2d5c20a7ac")
CURRENT_CONTEXT: ContextVar["AuthContext | None"] = ContextVar(
    "warm_graph_auth_context",
    default=None,
)


class AuthContext:
    def __init__(
        self,
        *,
        user_id: uuid.UUID,
        tenant_id: uuid.UUID,
        owner_id: str | None,
        roles: tuple[str, ...] = ("member",),
        authenticated: bool = True,
    ):
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.owner_id = owner_id
        self.roles = roles
        self.authenticated = authenticated

    def has_role(self, role: str) -> bool:
        return role in self.roles


def compatibility_context(owner_id: str) -> AuthContext:
    """Legacy owner mapping for the unconfigured synthetic MVP only."""
    return AuthContext(
        user_id=uuid.uuid5(COMPATIBILITY_NAMESPACE, f"user:{owner_id}"),
        tenant_id=uuid.uuid5(COMPATIBILITY_NAMESPACE, f"tenant:{owner_id}"),
        owner_id=owner_id,
        roles=("admin",),
        authenticated=False,
    )


def require_authenticated(context: AuthContext) -> AuthContext:
    if not context.authenticated:
        security_audit("authentication_required", "denied", {})
        raise HTTPException(status_code=401, detail="Authentication required")
    return context


def require_owner_access(context: AuthContext, owner_id: str) -> None:
    if not context.authenticated:
        return
    if context.owner_id != owner_id:
        security_audit(
            "authorization_failure",
            "denied",
            {"resource_type": "owner_network", "requested_owner_id": owner_id},
        )
        raise HTTPException(status_code=403, detail="Tenant access denied")


def require_admin(context: AuthContext) -> None:
    require_authenticated(context)
    if not context.has_role("admin"):
        security_audit("authorization_failure", "denied", {"required_role": "admin"})
        raise HTTPException(status_code=403, detail="Admin role required")


def current_context() -> AuthContext | None:
    return CURRENT_CONTEXT.get()
