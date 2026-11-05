CREATE TABLE IF NOT EXISTS calendar_schedules (
    id TEXT PRIMARY KEY,
    scheduled_date TEXT NOT NULL,
    until_date TEXT NOT NULL,
    repeat_rule TEXT NOT NULL,
    series_id TEXT REFERENCES calendar_schedules(id) ON DELETE CASCADE,
    original_date TEXT NOT NULL,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS calendar_by_date ON calendar_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS calendar_by_series ON calendar_schedules(series_id, original_date);
