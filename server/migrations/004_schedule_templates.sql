-- 004_schedule_templates.sql
-- Custom user/admin reusable schedule presets/templates

CREATE TABLE IF NOT EXISTS schedule_templates (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_user_id ON schedule_templates(user_id);
