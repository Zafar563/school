-- 005_user_telegram_bots.up.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_bot_token VARCHAR(255) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(100) DEFAULT '';
