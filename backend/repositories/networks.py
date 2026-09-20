from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.database import Database
from db.models import (
    AuditEvent,
    Company,
    NetworkMembership,
    Person,
    Relationship,
    RelationshipEvidence,
    Tenant,
    TenantUser,
    User,
)
from entity_resolution import (
    Resolution,
    ResolutionOutcome,
    normalize_company_name,
    normalize_email,
    normalize_profile_url,
    normalize_person_name,
    resolve_company,
    resolve_person,
)

COMPATIBILITY_NAMESPACE = uuid.UUID("d4bd7e26-6a1e-4b29-9b99-7e2d5c20a7ac")


def normalized_name(value: str | None) -> str:
    return normalize_person_name(value)


def stable_key(*values: Any) -> str:
    payload = json.dumps(values, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class PostgresNetworkRepository:
    """Normalized SQL repository with a legacy owner_id compatibility boundary.

    The compatibility owner ID is only a lookup key for development migration.
    It is not authentication or authorization.
    """

    def __init__(self, database: Database):
        self.database = database

    def _compatibility_context(
        self,
        session: Session,
        owner_id: str,
        tenant_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> tuple[Tenant, User]:
        if tenant_id is not None and user_id is not None:
            tenant = session.get(Tenant, tenant_id)
            user = session.get(User, user_id)
            if user is None:
                user = User(
                    id=user_id,
                    external_subject=f"auth:{user_id}",
                    display_name=str(user_id),
                )
                session.add(user)
                session.flush()
            if tenant is None:
                tenant = Tenant(
                    id=tenant_id,
                    name=f"Authenticated tenant {tenant_id}",
                    compatibility_owner_id=owner_id,
                )
                session.add(tenant)
                session.flush()
            elif tenant.compatibility_owner_id not in {None, owner_id}:
                raise ValueError("Owner ID is not associated with this tenant")
            if tenant.compatibility_owner_id is None:
                tenant.compatibility_owner_id = owner_id
            membership = session.scalar(
                select(TenantUser).where(
                    TenantUser.tenant_id == tenant.id,
                    TenantUser.user_id == user.id,
                )
            )
            if membership is None:
                session.add(TenantUser(
                    tenant_id=tenant.id,
                    user_id=user.id,
                    role="member",
                ))
                session.flush()
            return tenant, user

        tenant = session.scalar(
            select(Tenant).where(Tenant.compatibility_owner_id == owner_id)
        )
        if tenant is not None:
            user = session.scalar(
                select(User).join(TenantUser, TenantUser.user_id == User.id).where(
                    TenantUser.tenant_id == tenant.id
                )
            )
            if user is None:
                raise RuntimeError("Compatibility tenant has no owning user")
            return tenant, user

        user_id = uuid.uuid5(COMPATIBILITY_NAMESPACE, f"user:{owner_id}")
        tenant_id = uuid.uuid5(COMPATIBILITY_NAMESPACE, f"tenant:{owner_id}")
        user = User(
            id=user_id,
            external_subject=f"compatibility:{owner_id}",
            display_name=owner_id,
        )
        tenant = Tenant(
            id=tenant_id,
            name=f"Compatibility tenant {owner_id}",
            compatibility_owner_id=owner_id,
        )
        session.add_all([user, tenant])
        session.flush()
        session.add(TenantUser(tenant_id=tenant.id, user_id=user.id, role="compatibility"))
        return tenant, user

    def _person(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        record: dict[str, Any],
        *,
        owner: bool = False,
        metrics: dict[str, int] | None = None,
    ) -> Person:
        profile_url = record.get("profile_url")
        profile_url = normalize_profile_url(profile_url)
        provider_name = record.get("source") or "compatibility"
        provider_record_id = record.get("source_record_id")
        email = normalize_email(record.get("email"))
        if owner and not profile_url:
            provider_name = "compatibility"
            provider_record_id = f"owner:{record['owner_id']}"

        company_id = None
        if record.get("company"):
            company_id = self._company(
                session,
                tenant_id,
                str(record["company"]),
                record,
                metrics,
            ).id

        person = None
        resolution = None
        if profile_url:
            person = session.scalar(
                select(Person).where(
                    Person.tenant_id == tenant_id,
                    Person.profile_url == profile_url,
                )
            )
            if person is not None:
                resolution = Resolution(
                    ResolutionOutcome.EXACT,
                    person.id,
                    "canonical_profile_url",
                    0.99,
                    "Exact canonical profile URL match",
                )
        if person is None and provider_record_id:
            person = session.scalar(
                select(Person).where(
                    Person.tenant_id == tenant_id,
                    Person.provider_name == provider_name,
                    Person.provider_record_id == provider_record_id,
                )
            )
            if person is not None:
                resolution = Resolution(
                    ResolutionOutcome.EXACT,
                    person.id,
                    "provider_record_id",
                    1.0,
                    "Exact provider person ID match",
                )

        if person is None and email:
            email_candidates = session.scalars(
                select(Person).where(
                    Person.tenant_id == tenant_id,
                    Person.normalized_email == email,
                )
            ).all()
            if len(email_candidates) == 1:
                person = email_candidates[0]
                resolution = Resolution(
                    ResolutionOutcome.STRONG,
                    person.id,
                    "normalized_email",
                    0.97,
                    "Unique normalized email match",
                )

        if person is None:
            name_candidates = session.scalars(
                select(Person).where(
                    Person.tenant_id == tenant_id,
                    Person.normalized_name == normalize_person_name(
                        record.get("name") or record.get("display_name")
                    ),
                )
            ).all()
            candidate_records = []
            for candidate in name_candidates:
                candidate_record = {
                    "id": candidate.id,
                    "provider_record_id": candidate.provider_record_id,
                    "profile_url": candidate.profile_url,
                    "email": candidate.normalized_email,
                    "display_name": candidate.display_name,
                    "company": (candidate.record_metadata or {}).get("company"),
                    "headline": candidate.headline,
                }
                candidate_records.append(candidate_record)
            resolution = resolve_person(record, candidate_records)
            if resolution.should_merge:
                person = session.get(Person, resolution.entity_id)

        if metrics is not None:
            if person is not None:
                metrics["resolved"] += 1
            elif resolution is not None and resolution.outcome == ResolutionOutcome.POSSIBLE:
                metrics["ambiguous"] += 1
            else:
                metrics["unresolved"] += 1

        display_name = record.get("name") or record.get("display_name") or profile_url or "Unknown person"
        if person is None:
            if resolution is None:
                resolution = Resolution(
                    ResolutionOutcome.UNRESOLVED,
                    None,
                    "none",
                    0.0,
                    "No sufficiently strong tenant-scoped identity match",
                )
            person = Person(
                tenant_id=tenant_id,
                company_id=company_id,
                display_name=display_name,
                normalized_name=normalized_name(display_name),
                profile_url=profile_url,
                email=record.get("email"),
                normalized_email=email,
                headline=record.get("headline"),
                location=record.get("location"),
                provider_name=provider_name,
                provider_record_id=provider_record_id,
                resolution_method=resolution.method,
                resolution_confidence=resolution.confidence,
                resolution_outcome=resolution.outcome.value,
                record_metadata=dict(record),
            )
            session.add(person)
            if metrics is not None:
                metrics["created"] += 1
        else:
            person.display_name = display_name
            person.normalized_name = normalized_name(display_name)
            person.headline = record.get("headline") or person.headline
            person.location = record.get("location") or person.location
            person.company_id = company_id or person.company_id
            person.email = record.get("email") or person.email
            person.normalized_email = email or person.normalized_email
            if resolution is not None:
                person.resolution_method = resolution.method
                person.resolution_confidence = resolution.confidence
                person.resolution_outcome = resolution.outcome.value
            person.record_metadata = {**(person.record_metadata or {}), **record}
        session.flush()
        return person

    def _company(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        name: str,
        record: dict[str, Any],
        metrics: dict[str, int] | None = None,
    ) -> Company:
        normalized_company = normalize_company_name(name)
        candidates = session.scalars(
            select(Company).where(Company.tenant_id == tenant_id)
        ).all()
        candidate_records = [
            {
                "id": candidate.id,
                "provider_record_id": candidate.provider_record_id,
                "domain": candidate.domain,
                "name": candidate.name,
            }
            for candidate in candidates
        ]
        resolution = resolve_company(
            {
                "provider_record_id": record.get("company_source_record_id"),
                "domain": record.get("company_domain"),
                "name": name,
            },
            candidate_records,
        )
        company = session.get(Company, resolution.entity_id) if resolution.should_merge else None
        if company is None:
            company = Company(
                tenant_id=tenant_id,
                name=name,
                normalized_name=normalized_company,
                domain=record.get("company_domain"),
                provider_name=record.get("source"),
                provider_record_id=record.get("company_source_record_id"),
                resolution_method=resolution.method,
                resolution_confidence=resolution.confidence,
                resolution_outcome=resolution.outcome.value,
                record_metadata={"source_record": dict(record)},
            )
            session.add(company)
            if metrics is not None:
                metrics["created"] += 1
        else:
            if metrics is not None:
                metrics["resolved"] += 1
            company.name = name
            company.domain = record.get("company_domain") or company.domain
            company.resolution_method = resolution.method
            company.resolution_confidence = resolution.confidence
            company.resolution_outcome = resolution.outcome.value
            company.record_metadata = {
                **(company.record_metadata or {}),
                "source_record": dict(record),
            }
        session.flush()
        return company

    def _relationship(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        source_id: uuid.UUID,
        target_id: uuid.UUID | None,
        relationship_type: str,
        record: dict[str, Any],
        dedupe_key: str,
        *,
        observed_at: datetime | None = None,
        target_company_id: uuid.UUID | None = None,
    ) -> Relationship:
        relationship = session.scalar(
            select(Relationship).where(
                Relationship.tenant_id == tenant_id,
                Relationship.dedupe_key == dedupe_key,
            )
        )
        values = {
            "source_person_id": source_id,
            "target_person_id": target_id,
            "target_company_id": target_company_id,
            "relationship_type": relationship_type,
            "confidence": float(record.get("confidence", 1.0)),
            "observed_at": observed_at,
            "provider_name": record.get("source"),
            "provider_record_id": record.get("source_record_id"),
            "record_metadata": dict(record),
        }
        if relationship is None:
            relationship = Relationship(
                tenant_id=tenant_id,
                dedupe_key=dedupe_key,
                **values,
            )
            session.add(relationship)
        else:
            for key, value in values.items():
                setattr(relationship, key, value)
        session.flush()
        return relationship

    def save_network(
        self,
        owner_id: str,
        network_data: dict[str, Any],
        tenant_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> dict[str, int]:
        with self.database.transaction() as session:
            tenant, _ = self._compatibility_context(
                session,
                owner_id,
                tenant_id,
                user_id,
            )
            owner_record = {"owner_id": owner_id, "name": owner_id}
            metrics = {"resolved": 0, "created": 0, "ambiguous": 0, "unresolved": 0}
            owner_person = self._person(session, tenant.id, owner_record, owner=True, metrics=metrics)
            direct_people: dict[str, Person] = {}

            for company in network_data.get("companies", []):
                self._company(
                    session,
                    tenant.id,
                    str(company.get("name") or company.get("display_name") or "Unknown company"),
                    {
                        **company,
                        "source": company.get("source") or network_data.get("source"),
                    },
                    metrics,
                )

            for connection in network_data.get("connections", []):
                profile_url = connection.get("profile_url")
                if not profile_url and not connection.get("source_record_id"):
                    continue
                person = self._person(session, tenant.id, connection, metrics=metrics)
                direct_people[normalized_name(connection.get("name"))] = person
                membership = session.scalar(
                    select(NetworkMembership).where(
                        NetworkMembership.tenant_id == tenant.id,
                        NetworkMembership.person_id == person.id,
                        NetworkMembership.membership_type == "direct_connection",
                    )
                )
                membership_values = {
                    "connection_date_text": connection.get("connection_date"),
                    "source": connection.get("source"),
                    "provider_record_id": connection.get("source_record_id"),
                    "record_metadata": dict(connection),
                }
                if membership is None:
                    membership = NetworkMembership(
                        tenant_id=tenant.id,
                        person_id=person.id,
                        membership_type="direct_connection",
                        **membership_values,
                    )
                    session.add(membership)
                else:
                    for key, value in membership_values.items():
                        setattr(membership, key, value)
                self._relationship(
                    session,
                    tenant.id,
                    owner_person.id,
                    person.id,
                    "KNOWS",
                    connection,
                    f"direct:{person.id}",
                )

            evidence_count = 0
            relationship_count = 0
            for relationship in network_data.get("relationships", []):
                source = session.scalar(
                    select(Person).where(
                        Person.tenant_id == tenant.id,
                        Person.provider_record_id == relationship.get("source_provider_record_id"),
                    )
                )
                target = session.scalar(
                    select(Person).where(
                        Person.tenant_id == tenant.id,
                        Person.provider_record_id == relationship.get("target_provider_record_id"),
                    )
                ) if relationship.get("target_provider_record_id") else None
                target_company = session.scalar(
                    select(Company).where(
                        Company.tenant_id == tenant.id,
                        Company.provider_record_id == relationship.get("target_company_provider_record_id"),
                    )
                ) if relationship.get("target_company_provider_record_id") else None
                if source is None or (target is None and target_company is None):
                    continue
                relationship_key = stable_key(
                    "provider_relationship",
                    relationship.get("source_record_id")
                    or relationship.get("source_provider_record_id"),
                    relationship.get("target_provider_record_id"),
                    relationship.get("target_company_provider_record_id"),
                    relationship.get("relationship"),
                )
                self._relationship(
                    session,
                    tenant.id,
                    source.id,
                    target.id if target else None,
                    relationship.get("relationship", "KNOWS"),
                    relationship,
                    relationship_key,
                    observed_at=parse_timestamp(relationship.get("observed_at")),
                    target_company_id=target_company.id if target_company else None,
                )
                relationship_count += 1

            for evidence in network_data.get("relationship_evidence", []):
                target_url = evidence.get("profile_url")
                target_record = {
                    **evidence,
                    "profile_url": target_url,
                    "source_record_id": evidence.get("source_record_id"),
                    "name": evidence.get("name") or evidence.get("target_name") or "Unknown person",
                }
                if not target_url and not target_record.get("source_record_id"):
                    continue
                target = self._person(session, tenant.id, target_record, metrics=metrics)
                evidence_key = stable_key(
                    target_url,
                    evidence.get("observed_degree"),
                    evidence.get("source_record_id") or evidence.get("source"),
                )
                evidence_row = session.scalar(
                    select(RelationshipEvidence).where(
                        RelationshipEvidence.tenant_id == tenant.id,
                        RelationshipEvidence.dedupe_key == evidence_key,
                    )
                )
                evidence_values = {
                    "target_person_id": target.id,
                    "evidence_type": evidence.get("evidence_type") or "relationship_evidence",
                    "observed_degree": evidence.get("observed_degree"),
                    "provider_name": evidence.get("source"),
                    "provider_record_id": evidence.get("source_record_id"),
                    "observed_at": parse_timestamp(evidence.get("captured_at")),
                    "confidence": float(evidence.get("confidence", 1.0)),
                    "mutual_connection_names": evidence.get("mutual_connection_names", []),
                    "raw_metadata": {"visible_text": evidence.get("visible_text")},
                    "normalized_metadata": dict(evidence),
                }
                if evidence_row is None:
                    evidence_row = RelationshipEvidence(
                        tenant_id=tenant.id,
                        dedupe_key=evidence_key,
                        **evidence_values,
                    )
                    session.add(evidence_row)
                else:
                    for key, value in evidence_values.items():
                        setattr(evidence_row, key, value)
                evidence_count += 1

                if evidence.get("observed_degree") != "2nd":
                    continue
                matched_names = []
                for mutual_name in evidence.get("mutual_connection_names", []):
                    mutual = direct_people.get(normalized_name(mutual_name))
                    if mutual and mutual_name not in matched_names:
                        matched_names.append(mutual_name)
                        self._relationship(
                            session,
                            tenant.id,
                            mutual.id,
                            target.id,
                            "OBSERVED_MUTUAL",
                            {
                                **evidence,
                                "mutual_connection_name": mutual_name,
                                "mutual_connection_count": len(
                                    evidence.get("mutual_connection_names", [])
                                ),
                            },
                            f"observed:{evidence_key}:{mutual.id}",
                            observed_at=parse_timestamp(evidence.get("captured_at")),
                        )
                        relationship_count += 1

            return {
                "people": len(direct_people),
                "evidence": evidence_count,
                "relationships": relationship_count + len(direct_people),
                **metrics,
            }

    def load_network(
        self,
        owner_id: str,
        tenant_id: uuid.UUID | None = None,
    ) -> dict[str, Any] | None:
        with self.database.session_factory() as session:
            filters = [Tenant.compatibility_owner_id == owner_id]
            if tenant_id is not None:
                filters.append(Tenant.id == tenant_id)
            tenant = session.scalar(select(Tenant).where(*filters))
            if tenant is None:
                return None

            memberships = session.scalars(
                select(NetworkMembership).where(
                    NetworkMembership.tenant_id == tenant.id,
                    NetworkMembership.membership_type == "direct_connection",
                )
            ).all()
            connections = []
            for membership in memberships:
                person = session.get(Person, membership.person_id)
                if person is None:
                    continue
                record = dict(person.record_metadata or {})
                record.update({
                    "name": person.display_name,
                    "profile_url": person.profile_url,
                    "headline": person.headline,
                    "connection_date": membership.connection_date_text,
                    "source": membership.source or person.provider_name,
                    "degree": record.get("degree", "1st"),
                })
                connections.append(record)

            evidence_rows = session.scalars(
                select(RelationshipEvidence).where(
                    RelationshipEvidence.tenant_id == tenant.id
                )
            ).all()
            evidence = []
            for row in evidence_rows:
                person = session.get(Person, row.target_person_id) if row.target_person_id else None
                record = dict(row.normalized_metadata or {})
                record.update({
                    "name": person.display_name if person else record.get("name", ""),
                    "profile_url": person.profile_url if person else record.get("profile_url"),
                    "observed_degree": row.observed_degree,
                    "evidence_type": row.evidence_type,
                    "source": row.provider_name,
                    "mutual_connection_names": row.mutual_connection_names or [],
                    "captured_at": row.observed_at.isoformat() if row.observed_at else record.get("captured_at"),
                })
                evidence.append(record)

            return {
                "owner_id": owner_id,
                "source": "postgres",
                "connection_count": len(connections),
                "connections": connections,
                "relationship_evidence_count": len(evidence),
                "relationship_evidence": evidence,
            }

    def list_owner_ids(self) -> list[str]:
        with self.database.session_factory() as session:
            return list(session.scalars(select(Tenant.compatibility_owner_id).where(Tenant.compatibility_owner_id.is_not(None))))

    def record_audit(
        self,
        owner_id: str,
        action: str,
        status: str,
        source: str,
        record_count: int = 0,
        tenant_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> None:
        with self.database.transaction() as session:
            tenant, user = self._compatibility_context(
                session,
                owner_id,
                tenant_id,
                user_id,
            )
            session.add(AuditEvent(
                tenant_id=tenant.id,
                actor_user_id=user.id,
                action=action,
                status=status,
                source=source,
                record_count=record_count,
                event_metadata={"compatibility_owner_id": owner_id},
            ))
