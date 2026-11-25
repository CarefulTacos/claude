-- ไปด้วยกัน initial schema (Cloudflare D1 / SQLite).
-- Money is stored in whole baht (INTEGER). Dates are Bangkok calendar dates 'YYYY-MM-DD'.
-- Timestamps are ISO-8601 UTC strings.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE assistants (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname           TEXT NOT NULL,
  full_name          TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  line_id            TEXT NOT NULL DEFAULT '',
  district           TEXT NOT NULL DEFAULT '',
  weekdays           TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', -- 0=Sun .. 6=Sat
  background_checked INTEGER NOT NULL DEFAULT 0,
  trained_date       TEXT,
  insurance_expiry   TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left')),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE bookings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','paid','done','cancelled')),
  -- booker
  booker_name         TEXT NOT NULL,
  booker_phone        TEXT NOT NULL,
  booker_line         TEXT NOT NULL DEFAULT '',
  relationship        TEXT NOT NULL DEFAULT '',
  -- elder
  elder_name          TEXT NOT NULL,
  elder_age           INTEGER,
  elder_phone         TEXT,
  mobility            TEXT NOT NULL DEFAULT '',
  communication       TEXT NOT NULL DEFAULT '',
  communication_other TEXT NOT NULL DEFAULT '',
  health_notes        TEXT NOT NULL DEFAULT '',
  emergency_phone     TEXT NOT NULL DEFAULT '',
  -- appointment
  date                TEXT NOT NULL,
  pickup_time         TEXT NOT NULL DEFAULT '',
  pickup_address      TEXT NOT NULL DEFAULT '',
  district            TEXT NOT NULL DEFAULT '',
  maps_link           TEXT NOT NULL DEFAULT '',
  purpose             TEXT NOT NULL DEFAULT '',
  purpose_other       TEXT NOT NULL DEFAULT '',
  destination         TEXT NOT NULL DEFAULT '',
  stops               TEXT NOT NULL DEFAULT '',          -- up to 3 lines
  start_time          TEXT NOT NULL DEFAULT '',          -- time to be at the destination / appointment time
  fasting             TEXT NOT NULL DEFAULT '',          -- yes/no/unsure, medical purposes only
  second_person       INTEGER NOT NULL DEFAULT 0,        -- two elders travelling together
  errands             TEXT NOT NULL DEFAULT '',
  transport_mode      TEXT NOT NULL DEFAULT 'assistant',
  -- consent
  consent_terms       INTEGER NOT NULL DEFAULT 0,
  consent_health      INTEGER NOT NULL DEFAULT 0,
  consent_elder       INTEGER NOT NULL DEFAULT 0,
  consent_photo       INTEGER NOT NULL DEFAULT 0,
  consent_version     TEXT NOT NULL DEFAULT '',
  consent_at          TEXT,
  heard_from          TEXT NOT NULL DEFAULT '',
  -- pricing snapshot (copied from settings when the package is set)
  package_key         TEXT NOT NULL,
  package_name        TEXT NOT NULL DEFAULT '',
  package_price       INTEGER NOT NULL DEFAULT 0,
  package_pay         INTEGER NOT NULL DEFAULT 0,
  ot_block_min        INTEGER NOT NULL DEFAULT 30,
  ot_customer         INTEGER NOT NULL DEFAULT 0,
  ot_assistant        INTEGER NOT NULL DEFAULT 0,
  surcharge_customer  INTEGER NOT NULL DEFAULT 0,
  surcharge_assistant INTEGER NOT NULL DEFAULT 0,
  second_person_pct   INTEGER NOT NULL DEFAULT 0,
  evening_rate        INTEGER NOT NULL DEFAULT 0,
  -- operations
  assistant_id        INTEGER REFERENCES assistants(id),
  discount_pct        REAL NOT NULL DEFAULT 0,
  promo_applied       INTEGER NOT NULL DEFAULT 0,
  overtime_min        INTEGER NOT NULL DEFAULT 0,
  surcharge_count     INTEGER NOT NULL DEFAULT 0,        -- early start / outer district items
  evening             INTEGER NOT NULL DEFAULT 0,        -- evening surcharge applies
  transport_cost      INTEGER NOT NULL DEFAULT 0,
  received_service    INTEGER NOT NULL DEFAULT 0,
  received_extra      INTEGER NOT NULL DEFAULT 0,
  refund_paid         INTEGER NOT NULL DEFAULT 0,
  assistant_paid      INTEGER NOT NULL DEFAULT 0,
  assistant_paid_at   TEXT,
  cancelled_by        TEXT,
  cancelled_at        TEXT,
  cancel_hours_before REAL,
  assistant_arrived   INTEGER NOT NULL DEFAULT 0,
  next_appointment    TEXT,
  review_score        INTEGER,
  internal_notes      TEXT NOT NULL DEFAULT '',
  anonymized_at       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_phone ON bookings(booker_phone);
CREATE INDEX idx_bookings_assistant ON bookings(assistant_id, date);
CREATE INDEX idx_bookings_next ON bookings(next_appointment);
CREATE INDEX idx_bookings_purpose ON bookings(purpose);

CREATE TABLE expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  item       TEXT NOT NULL,
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(date);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  booking_id INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_booking ON audit_log(booking_id);

-- Hashed client keys (SHA-256 of IP + secret), fixed time windows.
CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hash, window_start)
);
