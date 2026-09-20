from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import Uuid


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_subject: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(255))


class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Compatibility only. This is not an authenticated identity.
    compatibility_owner_id: Mapped[str | None] = mapped_column(String(2048), unique=True)


class TenantUser(Base):
    __tablename__ = "tenant_users"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Company(TimestampMixin, Base):
    __tablename__ = "companies"
    __table_args__ = (
        Index("ix_companies_tenant_name", "tenant_id", "normalized_name"),
        Index("ix_companies_tenant_domain", "tenant_id", "domain"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(512), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255))
    provider_name: Mapped[str | None] = mapped_column(String(128))
    provider_record_id: Mapped[str | None] = mapped_column(String(512))
    resolution_method: Mapped[str | None] = mapped_column(String(128))
    resolution_confidence: Mapped[float | None] = mapped_column(Float)
    resolution_outcome: Mapped[str | None] = mapped_column(String(32))
    record_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class Person(TimestampMixin, Base):
    __tablename__ = "people"
    __table_args__ = (
        UniqueConstraint("tenant_id", "profile_url", name="uq_people_tenant_profile"),
        UniqueConstraint("tenant_id", "provider_name", "provider_record_id", name="uq_people_provider_record"),
        Index("ix_people_tenant_name", "tenant_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )
    display_name: Mapped[str] = mapped_column(String(512), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(512), nullable=False)
    profile_url: Mapped[str | None] = mapped_column(String(2048))
    email: Mapped[str | None] = mapped_column(String(320))
    normalized_email: Mapped[str | None] = mapped_column(String(320))
    headline: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(512))
    provider_name: Mapped[str | None] = mapped_column(String(128))
    provider_record_id: Mapped[str | None] = mapped_column(String(512))
    resolution_method: Mapped[str | None] = mapped_column(String(128))
    resolution_confidence: Mapped[float | None] = mapped_column(Float)
    resolution_outcome: Mapped[str | None] = mapped_column(String(32))
    record_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class NetworkMembership(TimestampMixin, Base):
    __tablename__ = "network_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "person_id", "membership_type", name="uq_network_membership"),
        Index("ix_network_memberships_tenant_type", "tenant_id", "membership_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    person_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE"), nullable=False
    )
    membership_type: Mapped[str] = mapped_column(String(64), nullable=False)
    connection_date: Mapped[Date | None] = mapped_column(Date)
    connection_date_text: Mapped[str | None] = mapped_column(String(128))
    source: Mapped[str | None] = mapped_column(String(128))
    provider_record_id: Mapped[str | None] = mapped_column(String(512))
    record_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class Relationship(TimestampMixin, Base):
    __tablename__ = "relationships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "dedupe_key", name="uq_relationship_tenant_key"),
        Index("ix_relationships_tenant_source", "tenant_id", "source_person_id"),
        Index("ix_relationships_tenant_target", "tenant_id", "target_person_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    source_person_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE"), nullable=False
    )
    target_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE")
    )
    target_company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE")
    )
    relationship_type: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_name: Mapped[str | None] = mapped_column(String(128))
    provider_record_id: Mapped[str | None] = mapped_column(String(512))
    dedupe_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    record_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class RelationshipEvidence(TimestampMixin, Base):
    __tablename__ = "relationship_evidence"
    __table_args__ = (
        UniqueConstraint("tenant_id", "dedupe_key", name="uq_evidence_tenant_key"),
        Index("ix_evidence_tenant_target", "tenant_id", "target_person_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    target_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE")
    )
    target_company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE")
    )
    evidence_type: Mapped[str] = mapped_column(String(128), nullable=False)
    observed_degree: Mapped[str | None] = mapped_column(String(32))
    provider_name: Mapped[str | None] = mapped_column(String(128))
    provider_record_id: Mapped[str | None] = mapped_column(String(512))
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    mutual_connection_names: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    raw_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    normalized_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(1024), nullable=False)


class Deal(TimestampMixin, Base):
    __tablename__ = "deals"
    __table_args__ = (Index("ix_deals_tenant_status", "tenant_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    side: Mapped[str] = mapped_column(String(32), nullable=False)
    target_company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )
    target_company_name: Mapped[str] = mapped_column(String(512), nullable=False)
    sector: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_tenant_status", "tenant_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class AuditEvent(TimestampMixin, Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_tenant_created", "tenant_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(128), nullable=False, default="system")
    request_id: Mapped[str | None] = mapped_column(String(128))
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL")
    )
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
