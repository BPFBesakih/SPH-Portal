BEGIN;
ALTER TABLE portal.coaching_links ADD COLUMN share_token TEXT CHECK(share_token IS NULL OR length(share_token)=64);
COMMENT ON COLUMN portal.coaching_links.share_token IS 'Private recoverable form link; only global coaching managers may retrieve it. Never include in public assets or logs.';
COMMIT;
