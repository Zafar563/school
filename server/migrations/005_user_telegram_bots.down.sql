-- 005_user_telegram_bots.down.sql
ALTER TABLE users DROP COLUMN IF EXISTS telegram_chat_id;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_bot_token;
