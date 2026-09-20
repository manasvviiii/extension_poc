"""Add deterministic entity-resolution provenance fields.

Revision ID: 20260920_02
Revises: 20260920_01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20260920_02"
down_revision: Union[str, Sequence[str], None] = "20260920_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    company_constraints = {
        item["name"]
        for item in inspector.get_unique_constraints("companies")
    }
    if "uq_company_tenant_name" in company_constraints:
        with op.batch_alter_table("companies") as batch:
            batch.drop_constraint("uq_company_tenant_name", type_="unique")
    if "ix_companies_tenant_name" not in {
        item["name"] for item in inspector.get_indexes("companies")
    }:
        op.create_index("ix_companies_tenant_name", "companies", ["tenant_id", "normalized_name"])

    people_columns = {item["name"] for item in inspector.get_columns("people")}
    with op.batch_alter_table("people") as batch:
        for name, column in (
            ("email", sa.Column("email", sa.String(length=320), nullable=True)),
            ("normalized_email", sa.Column("normalized_email", sa.String(length=320), nullable=True)),
            ("resolution_method", sa.Column("resolution_method", sa.String(length=128), nullable=True)),
            ("resolution_confidence", sa.Column("resolution_confidence", sa.Float(), nullable=True)),
            ("resolution_outcome", sa.Column("resolution_outcome", sa.String(length=32), nullable=True)),
        ):
            if name not in people_columns:
                batch.add_column(column)

    company_columns = {item["name"] for item in inspector.get_columns("companies")}
    with op.batch_alter_table("companies") as batch:
        for name, column in (
            ("resolution_method", sa.Column("resolution_method", sa.String(length=128), nullable=True)),
            ("resolution_confidence", sa.Column("resolution_confidence", sa.Float(), nullable=True)),
            ("resolution_outcome", sa.Column("resolution_outcome", sa.String(length=32), nullable=True)),
        ):
            if name not in company_columns:
                batch.add_column(column)


def downgrade() -> None:
    op.drop_index("ix_companies_tenant_name", table_name="companies")
    with op.batch_alter_table("companies") as batch:
        batch.create_unique_constraint("uq_company_tenant_name", ["tenant_id", "normalized_name"])
        batch.drop_column("resolution_outcome")
        batch.drop_column("resolution_confidence")
        batch.drop_column("resolution_method")
    with op.batch_alter_table("people") as batch:
        batch.drop_column("normalized_email")
        batch.drop_column("email")
        batch.drop_column("resolution_outcome")
        batch.drop_column("resolution_confidence")
        batch.drop_column("resolution_method")