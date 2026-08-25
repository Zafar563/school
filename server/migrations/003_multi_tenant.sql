-- 003_multi_tenant.sql
-- Ko'p foydalanuvchili (Multi-tenant) arxitektura: Har bir maktab/user uchun alohida jadval va qurilma

-- 1. Users jadvaliga maktab va qurilma holati maydonlarini qo'shish
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name VARCHAR(255) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bell_muted BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_coords JSONB;

-- 2. Schedule_items jadvalini user_id ga bog'lash
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
UPDATE schedule_items SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_user_day ON schedule_items(user_id, day_of_week);

-- 3. Holidays jadvalini user_id ga bog'lash
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
UPDATE holidays SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;

-- Eski global unique constraint (faqat date) o'rniga har bir user uchun alohida (user_id, date) unikal qilish
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_date_key') THEN
    ALTER TABLE holidays DROP CONSTRAINT holidays_date_key;
  END IF;
END $$;

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_user_date_unique;
ALTER TABLE holidays ADD CONSTRAINT holidays_user_date_unique UNIQUE (user_id, date);
CREATE INDEX IF NOT EXISTS idx_holidays_user_date ON holidays(user_id, date);

-- 4. Pending_commands jadvalini user_id ga bog'lash
ALTER TABLE pending_commands ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_commands(user_id);
