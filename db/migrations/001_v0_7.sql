CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 3200 CHECK (balance >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_player
  ON player_sessions(player_id);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  youtube_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_id TEXT,
  channel_title TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at TEXT,
  duration_seconds INTEGER,
  latest_views INTEGER,
  latest_likes INTEGER,
  latest_comments INTEGER,
  latest_snapshot_at TEXT,
  metadata_mode TEXT NOT NULL DEFAULT 'youtube-api',
  stats_mode TEXT NOT NULL DEFAULT 'youtube-api',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_snapshots (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  views INTEGER NOT NULL CHECK (views >= 0),
  likes INTEGER CHECK (likes >= 0),
  comments INTEGER CHECK (comments >= 0),
  UNIQUE(video_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_video_snapshots_video_time
  ON video_snapshots(video_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS feed_candidates (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  lane TEXT NOT NULL DEFAULT 'direct',
  status TEXT NOT NULL DEFAULT 'observing',
  signal_score REAL,
  signal_label TEXT NOT NULL DEFAULT 'NEW · 관측 중',
  first_seen_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feed_candidates_score
  ON feed_candidates(status, signal_score DESC, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS watches (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  alert_mode TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL,
  PRIMARY KEY(player_id, video_id)
);

CREATE TABLE IF NOT EXISTS discoveries (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  discovery_rank INTEGER NOT NULL CHECK (discovery_rank > 0),
  discovered_at TEXT NOT NULL,
  UNIQUE(player_id, video_id),
  UNIQUE(video_id, discovery_rank)
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  discovery_id TEXT NOT NULL REFERENCES discoveries(id),
  entry_views INTEGER NOT NULL CHECK (entry_views >= 0),
  early_bonus REAL NOT NULL,
  rules_version TEXT NOT NULL,
  planted_at TEXT NOT NULL,
  auto_harvest_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  harvested_at TEXT,
  UNIQUE(player_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_positions_player_status
  ON positions(player_id, status);

CREATE INDEX IF NOT EXISTS idx_positions_auto_harvest
  ON positions(status, auto_harvest_at);

CREATE TABLE IF NOT EXISTS harvests (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL UNIQUE REFERENCES positions(id),
  video_id TEXT NOT NULL REFERENCES videos(id),
  entry_views INTEGER NOT NULL,
  final_views INTEGER NOT NULL,
  ratio REAL NOT NULL,
  early_bonus REAL NOT NULL,
  payout INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  discovery_rank INTEGER NOT NULL,
  grade TEXT NOT NULL,
  grade_label TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  planted_at TEXT NOT NULL,
  harvested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_harvests_player_time
  ON harvests(player_id, harvested_at DESC);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  requests_used INTEGER NOT NULL DEFAULT 0,
  items_seen INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collector_runs_kind_time
  ON collector_runs(kind, finished_at DESC);
