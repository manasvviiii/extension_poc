from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


_sink: Callable[[str, str, dict[str, Any]], None] | None = None


def configure_security_audit_sink(
    sink: Callable[[str, str, dict[str, Any]], None],
) -> None:
    global _sink
    _sink = sink


def security_audit(action: str, status: str, metadata: dict[str, Any] | None = None) -> None:
    safe_metadata = metadata or {}
    if _sink is not None:
        _sink(action, status, safe_metadata)
        return

    audit_dir = Path(
        os.getenv(
            "AUDIT_DIR",
            str(Path(__file__).resolve().parents[1] / "data" / "audit"),
        )
    )
    audit_dir.mkdir(parents=True, exist_ok=True)
    path = audit_dir / f"{datetime.now(timezone.utc).date().isoformat()}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "status": status,
            "source": "authentication",
            "metadata": safe_metadata,
        }, ensure_ascii=False) + "\n")
