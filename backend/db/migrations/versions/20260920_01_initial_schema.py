"""Create the normalized Warm Graph persistence schema.

Revision ID: 20260920_01
Revises:
"""
from typing import Sequence, Union

from alembic import op

from db.models import Base

revision: str = "20260920_01"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The model metadata is deliberately used only for this initial schema.
    # Future migrations should use explicit Alembic operations.
    Base.metadata.create_all(op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
