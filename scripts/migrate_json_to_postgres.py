"""Import legacy network JSON files into PostgreSQL without deleting them."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from db.database import Database  # noqa: E402
from repositories.networks import PostgresNetworkRepository  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument(
        "--data-dir",
        default=str(BACKEND / "data" / "networks"),
    )
    args = parser.parse_args()

    repository = PostgresNetworkRepository(Database(args.database_url))
    counts = {"imported": 0, "skipped": 0, "errors": 0}

    for path in sorted(Path(args.data_dir).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            owner_id = data.get("owner_id")
            if not owner_id:
                counts["skipped"] += 1
                print(f"SKIP {path}: missing owner_id")
                continue
            result = repository.save_network(owner_id, data)
            counts["imported"] += 1
            print(
                f"IMPORT {path.name}: owner={owner_id} "
                f"people={result['people']} evidence={result['evidence']}"
            )
        except Exception as error:
            counts["errors"] += 1
            print(f"ERROR {path}: {error}", file=sys.stderr)

    print(json.dumps(counts, sort_keys=True))
    return 1 if counts["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
