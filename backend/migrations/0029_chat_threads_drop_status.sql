-- Remove the chat_threads.status and closed_at columns. Nothing ever wrote
-- 'closed'. Chat threads are created only for accepted or completed matches,
-- and every transition away from accepted such as a block or match completion
-- is already enforced through matches.status and blocks at read and send time.
-- The columns and the ErrChatClosed path were latent dead code from B3. This
-- drops them instead of inventing a thread-close flow with no product trigger.
ALTER TABLE chat_threads
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS closed_at;
