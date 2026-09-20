from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker


def normalize_database_url(url: str) -> str:
    """Use psycopg 3 for PostgreSQL while leaving SQLite URLs unchanged."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def create_engine_for_url(url: str | None = None) -> Engine:
    database_url = url or os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL is required for database persistence")

    engine = create_engine(
        normalize_database_url(database_url),
        pool_pre_ping=True,
    )

    if database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, connection_record):
            del connection_record
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


class Database:
    """Small SQLAlchemy boundary used by repositories and migration tests."""

    def __init__(self, url: str | None = None, engine: Engine | None = None):
        self.engine = engine or create_engine_for_url(url)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )

    def create_schema_for_tests(self) -> None:
        from .models import Base

        Base.metadata.create_all(self.engine)

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        with self.session_factory() as session:
            with session.begin():
                yield session
