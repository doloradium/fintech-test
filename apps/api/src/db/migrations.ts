export type Migration = {
  id: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: '0001_initial',
    sql: `
      CREATE TABLE funnel_versions (
        version INTEGER PRIMARY KEY,
        funnel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        source TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE funnel_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_version INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE version_activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        funnel_id TEXT NOT NULL,
        funnel_version INTEGER NOT NULL,
        variant TEXT NOT NULL,
        variant_source TEXT NOT NULL,
        current_step_id TEXT NOT NULL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX idx_sessions_version ON sessions (funnel_version);
      CREATE INDEX idx_sessions_variant ON sessions (variant);
      CREATE INDEX idx_sessions_campaign ON sessions (utm_campaign);
      CREATE INDEX idx_sessions_created ON sessions (created_at);

      CREATE TABLE session_answers (
        session_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, step_id)
      );

      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        funnel_version INTEGER NOT NULL,
        variant TEXT NOT NULL,
        step_id TEXT,
        seq INTEGER,
        client_ts TEXT NOT NULL,
        server_ts TEXT NOT NULL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        props_json TEXT
      );

      CREATE INDEX idx_events_session ON events (session_id);
      CREATE INDEX idx_events_type ON events (type);
      CREATE INDEX idx_events_version_variant ON events (funnel_version, variant);
      CREATE INDEX idx_events_step ON events (step_id);

      CREATE TABLE ingest_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        accepted INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO ingest_stats (id, accepted, duplicates, rejected) VALUES (1, 0, 0, 0);
    `,
  },
];
