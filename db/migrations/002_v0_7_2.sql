ALTER TABLE players
  ADD COLUMN field_value INTEGER NOT NULL DEFAULT 3200 CHECK (field_value >= 0);

CREATE INDEX IF NOT EXISTS idx_players_field_value
  ON players(field_value DESC, updated_at ASC);
