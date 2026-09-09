-- 003_multi_tenant.down.sql
ALTER TABLE pending_commands DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_user_date_unique;
ALTER TABLE holidays DROP COLUMN IF EXISTS user_id CASCADE;
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_date_key') THEN
    ALTER TABLE holidays ADD CONSTRAINT holidays_date_key UNIQUE (date);
  END IF;
END $body$;

ALTER TABLE schedule_items DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE users DROP COLUMN IF EXISTS custom_coords;
ALTER TABLE users DROP COLUMN IF EXISTS geo;
ALTER TABLE users DROP COLUMN IF EXISTS last_ip;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen;
ALTER TABLE users DROP COLUMN IF EXISTS bell_muted;
ALTER TABLE users DROP COLUMN IF EXISTS school_name;
