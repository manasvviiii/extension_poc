# Warm Graph Extension POC

Validates: network data -> extension -> FastAPI -> stored network.

The demo intentionally uses a LOCAL mock connections page and fixed test data.
It does not scrape LinkedIn or bypass LinkedIn controls.

## Backend
```powershell
cd backend
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Extension
1. Open chrome://extensions
2. Enable Developer mode
3. Load unpacked -> select `extension`
4. Open the extension
5. Click Check backend
6. Click Import demo network

Expected: Imported 3 connections. Owner: banker_A

## PostgreSQL persistence (Phase 2)

The MVP JSON files remain available as the explicit compatibility backend for
the existing synthetic tests. PostgreSQL is selected when `DATABASE_URL` is
set, or explicitly with `STORAGE_BACKEND=postgres`. The compatibility
`owner_id` mapping is a migration aid, not authentication or authorization.

Start a local database with Docker Compose:

```powershell
docker compose up -d postgres
cd backend
pip install -r requirements.txt
$env:DATABASE_URL = "postgresql://warmgraph:warmgraph_dev@127.0.0.1:5432/warmgraph"
alembic upgrade head
```

Import existing network JSON files without deleting them:

```powershell
python scripts/migrate_json_to_postgres.py `
	--database-url $env:DATABASE_URL
```

The normalized schema stores UUID users and tenants, people, companies,
network memberships, typed relationships, provenance-rich relationship
evidence, deals, jobs, and audit events. NetworkX graphs can be rebuilt from
the PostgreSQL repository; the existing graph construction, path discovery,
and warmth scoring behavior is unchanged.

## Relationship providers and entity resolution (Phase 7)

`RelationshipDataProvider` remains the provider boundary. Approved providers
must return normalized provider-neutral snapshots; they never access FastAPI,
repositories, or NetworkX. `MockRelationshipDataProvider` is fixture-only and
is used for deterministic local tests. `ApprovedRelationshipDataProvider`
continues to fail clearly when no licensed/API implementation is configured.

Provider ingestion passes through `ProviderIngestionService` and the
tenant-scoped repository. People resolve in this order: provider record ID,
canonical profile URL, normalized email, then normalized name plus company or
headline. Ambiguous name-only matches are not merged. Companies resolve by
provider ID, canonical domain, or a unique normalized name. Resolution method,
confidence, outcome, provider ID, observation time, and source metadata remain
persisted for auditability.

## Development authentication

The legacy default is `AUTH_MODE=compatibility`, which preserves the original
synthetic extension contract but is not authentication and must not be used in
production. For authenticated local testing, set `AUTH_MODE=development` and
configure `DEV_AUTH_TOKEN` plus `DEV_OWNER_ID`, or provide a JSON
`DEV_AUTH_TOKENS` mapping from tokens to `{user_id, tenant_id, owner_id, roles}`.
Send the token as `X-WarmGraph-Dev-Token`. The server validates every
owner-scoped request against the authenticated development context. A future
OIDC/JWT adapter can replace this dependency without changing repositories or
business logic. `AUTH_MODE=disabled` fails closed for protected requests.

## Next
Once an approved LinkedIn data-access mechanism is available, replace only the demo ingestion source. Keep the backend/graph architecture.
