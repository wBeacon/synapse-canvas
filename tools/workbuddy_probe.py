#!/usr/bin/env python3
"""Read-only WorkBuddy storage probe; emits counts, never conversation bodies."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import plistlib
import sqlite3
import time


def read_records(path):
    records = []
    invalid = 0
    incomplete = 0
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.endswith("\n"):
                incomplete += 1
                continue
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    invalid += 1
                    continue
                records.append(record)
            except ValueError:
                invalid += 1
    return records, invalid, incomplete


def message_text(record):
    content = record.get("content", [])
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        block["text"]
        for block in content
        if isinstance(block, dict) and isinstance(block.get("text"), str)
    )


def database_summary(home):
    path = home / "workbuddy.db"
    if not path.is_file():
        return {"available": False}, set()
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
        rows = connection.execute("SELECT id FROM sessions").fetchall()
        active = connection.execute(
            "SELECT count(*) FROM sessions WHERE deleted_at IS NULL"
        ).fetchone()[0]
        return {
            "available": True,
            "total_sessions": len(rows),
            "non_deleted_sessions": active,
        }, {row[0] for row in rows}
    finally:
        connection.close()


def snapshot(home, marker=None, expected_replies=()):
    database, session_ids = database_summary(home)
    files = sorted((home / "projects").glob("*/*.jsonl"))
    types, roles = Counter(), Counter()
    selected = invalid = incomplete = 0
    matches = [0] * len(expected_replies)
    for path in files:
        records, bad, pending = read_records(path)
        if marker is not None and not any(
            record.get("type") == "message"
            and record.get("role") == "user"
            and marker in message_text(record)
            for record in records
        ):
            continue
        selected += 1
        invalid += bad
        incomplete += pending
        for record in records:
            kind = record.get("type")
            types[str(kind)] += 1
            if kind == "message":
                role = record.get("role")
                roles[str(role)] += 1
                if role == "assistant":
                    text = message_text(record).strip()
                    for index, expected in enumerate(expected_replies):
                        matches[index] += int(text == expected)
    return {
        "mode": "read-only-storage-probe",
        "selection": "user-message-marker" if marker is not None else "all-local",
        "database": database,
        "transcript_files": len(files),
        "transcripts_matching_index": sum(path.stem in session_ids for path in files),
        "selected_transcripts": selected,
        "record_types": dict(sorted(types.items())),
        "message_roles": dict(sorted(roles.items())),
        "invalid_lines": invalid,
        "incomplete_lines": incomplete,
        "expected_reply_match_counts": matches,
    }


def installed_version():
    path = Path("/Applications/WorkBuddy.app/Contents/Info.plist")
    if not path.is_file():
        return None
    return plistlib.loads(path.read_bytes()).get("CFBundleShortVersionString")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home() / ".workbuddy")
    parser.add_argument("--marker", help="Select transcripts containing this user-message marker")
    parser.add_argument("--expect-reply", action="append", default=[])
    parser.add_argument("--watch-seconds", type=float, default=0)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()
    if not 0 <= args.watch_seconds <= 60:
        parser.error("--watch-seconds must be between 0 and 60")
    if args.interval <= 0:
        parser.error("--interval must be positive")
    deadline = time.monotonic() + args.watch_seconds
    previous = None
    while True:
        try:
            result = snapshot(args.home, args.marker, args.expect_reply)
            result["installed_version"] = installed_version()
        except (OSError, sqlite3.Error) as error:
            # Do not include exception messages containing local paths or data.
            print(json.dumps({"error": type(error).__name__, "mode": "read-only"}), flush=True)
            return 1
        if result != previous:
            print(json.dumps({
                "observed_at": datetime.now(timezone.utc).isoformat(),
                **result,
            }, ensure_ascii=False), flush=True)
            previous = result
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(args.interval, remaining))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
