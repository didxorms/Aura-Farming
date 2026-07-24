ALTER TABLE videos ADD COLUMN category_id TEXT;

ALTER TABLE feed_candidates ADD COLUMN views_per_hour REAL;
ALTER TABLE feed_candidates ADD COLUMN growth_rate_per_hour REAL;
ALTER TABLE feed_candidates ADD COLUMN acceleration REAL;
ALTER TABLE feed_candidates ADD COLUMN engagement_rate REAL;
ALTER TABLE feed_candidates ADD COLUMN confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE feed_candidates ADD COLUMN opportunity_score REAL;
ALTER TABLE feed_candidates ADD COLUMN score_delta REAL NOT NULL DEFAULT 0;
ALTER TABLE feed_candidates ADD COLUMN snapshot_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feed_candidates ADD COLUMN signal_reason TEXT NOT NULL DEFAULT '데이터 수집 중';
ALTER TABLE feed_candidates ADD COLUMN engine_version TEXT NOT NULL DEFAULT '0.7.2';

UPDATE feed_candidates
SET lane = CASE lane
  WHEN '웃긴|밈|챌린지' THEN '유머·밈'
  WHEN '강아지|고양이|반려동물' THEN '동물'
  WHEN '음식|요리|먹방' THEN '푸드'
  WHEN '게임|엔터테인먼트' THEN '게임·엔터'
  ELSE lane
END;

CREATE INDEX IF NOT EXISTS idx_feed_candidates_status_score_v08
  ON feed_candidates(status, signal_score DESC, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_videos_channel
  ON videos(channel_id, latest_snapshot_at DESC);
