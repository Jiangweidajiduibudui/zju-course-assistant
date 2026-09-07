// Append-only SQL migrations. Never edit a migration already used by a release.
export const migrations = [
  `CREATE TABLE snapshots(id TEXT PRIMARY KEY, term_id TEXT NOT NULL, captured_at TEXT NOT NULL, live INTEGER NOT NULL CHECK(live IN (0,1)), data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE INDEX snapshots_term ON snapshots(term_id,captured_at);
   CREATE TABLE plans(id TEXT PRIMARY KEY, term_id TEXT NOT NULL, snapshot_id TEXT NOT NULL REFERENCES snapshots(id), revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE INDEX plans_term ON plans(term_id);
   CREATE TABLE resources(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(kind,id));
   CREATE TABLE idempotency(key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)));
   CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0));
   INSERT INTO state VALUES(1,1);`,
] as const;
