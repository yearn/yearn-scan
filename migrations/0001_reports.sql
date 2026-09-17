CREATE TABLE activity_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sequence INTEGER NOT NULL
);
INSERT INTO activity_clock (id, sequence) VALUES (1, 0);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  owner_fingerprint TEXT NOT NULL,
  client TEXT NOT NULL,
  run_id TEXT NOT NULL,
  create_payload TEXT NOT NULL CHECK (json_valid(create_payload)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  repository TEXT GENERATED ALWAYS AS (json_extract(payload, '$.repository')) STORED NOT NULL,
  scan_type TEXT GENERATED ALWAYS AS (json_extract(payload, '$.scan_type')) STORED NOT NULL,
  status TEXT GENERATED ALWAYS AS (json_extract(payload, '$.status')) STORED NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  activity_seq INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner_fingerprint, run_id)
);

CREATE TRIGGER reports_created AFTER INSERT ON reports BEGIN
  UPDATE activity_clock SET sequence = sequence + 1 WHERE id = 1;
  UPDATE reports SET activity_seq = (SELECT sequence FROM activity_clock WHERE id = 1) WHERE id = NEW.id;
END;

CREATE TRIGGER reports_changed AFTER UPDATE OF payload ON reports
WHEN OLD.payload <> NEW.payload BEGIN
  UPDATE activity_clock SET sequence = sequence + 1 WHERE id = 1;
  UPDATE reports SET
    activity_seq = (SELECT sequence FROM activity_clock WHERE id = 1),
    updated_at = MAX(OLD.updated_at + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  WHERE id = NEW.id;
END;

CREATE INDEX reports_repository_activity ON reports(repository, activity_seq DESC, id DESC);
CREATE INDEX reports_type_status ON reports(scan_type, status);
