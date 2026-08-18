-- 001_init_schema.sql
-- Maktab Qo'ng'irog'i Tizimi — Dastlabki PostgreSQL sxemasi

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  api_key VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_items (
  id SERIAL PRIMARY KEY,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  hour INT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute INT NOT NULL CHECK (minute BETWEEN 0 AND 59),
  duration_sec INT NOT NULL DEFAULT 5,
  label VARCHAR(255) DEFAULT '',
  ring_pattern VARCHAR(50) NOT NULL DEFAULT 'continuous',
  pulse_count INT NOT NULL DEFAULT 3,
  pulse_gap_sec INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_schedule_day ON schedule_items(day_of_week);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS pending_commands (
  id SERIAL PRIMARY KEY,
  command JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
