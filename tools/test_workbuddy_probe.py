import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from workbuddy_probe import snapshot


class WorkBuddyProbeTest(unittest.TestCase):
    def test_summary_omits_bodies_and_leaves_source_files_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            project = home / "projects" / "example"
            project.mkdir(parents=True)
            database = home / "workbuddy.db"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE sessions (id TEXT, deleted_at INTEGER)")
                connection.execute("INSERT INTO sessions VALUES ('sample', NULL)")
            transcript = project / "sample.jsonl"
            records = [
                {"type": "message", "role": "user", "content": [{"text": "PRIVATE_BODY marker"}]},
                {"type": "message", "role": "assistant", "content": [{"text": "OK"}]},
                {"type": "function_call", "arguments": "PRIVATE_ARGUMENTS"},
            ]
            transcript.write_text("".join(json.dumps(row) + "\n" for row in records))
            before = {path: path.read_bytes() for path in [database, transcript]}
            result = snapshot(home, "marker", ["OK"])
            self.assertEqual(result["transcripts_matching_index"], 1)
            self.assertEqual(result["message_roles"], {"user": 1, "assistant": 1})
            self.assertEqual(result["expected_reply_match_counts"], [1])
            self.assertNotIn("PRIVATE", json.dumps(result))
            for path, content in before.items():
                self.assertEqual(path.read_bytes(), content)

    def test_partial_record_does_not_become_a_completed_reply(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            project = home / "projects" / "example"
            project.mkdir(parents=True)
            partial = json.dumps({"type": "message", "role": "assistant", "content": "OK"})
            (project / "sample.jsonl").write_text("not-json\n" + partial)
            result = snapshot(home, expected_replies=["OK"])
            self.assertEqual(result["invalid_lines"], 1)
            self.assertEqual(result["incomplete_lines"], 1)
            self.assertEqual(result["expected_reply_match_counts"], [0])

    def test_marker_in_assistant_reply_does_not_select_an_unrelated_session(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            project = home / "projects" / "example"
            project.mkdir(parents=True)
            record = {"type": "message", "role": "assistant", "content": "marker"}
            (project / "sample.jsonl").write_text(json.dumps(record) + "\n")
            self.assertEqual(snapshot(home, "marker")["selected_transcripts"], 0)


if __name__ == "__main__":
    unittest.main()
