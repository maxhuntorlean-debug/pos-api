-- =====================================================
-- EVENT LOG
-- Серверный журнал событий
-- =====================================================

CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  user_id INTEGER,
  username TEXT,

  event_type TEXT NOT NULL,
  details TEXT
);


-- =====================================================
-- INDEX: DATE / TIME
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_event_log_created_at
ON event_log(created_at);


-- =====================================================
-- INDEX: USER
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_event_log_user_id
ON event_log(user_id);


-- =====================================================
-- INDEX: EVENT TYPE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_event_log_event_type
ON event_log(event_type);