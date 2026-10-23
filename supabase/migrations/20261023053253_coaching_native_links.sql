BEGIN;
CREATE TABLE portal.coaching_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64), label TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX coaching_one_active_link ON portal.coaching_links(is_active) WHERE is_active=1;
ALTER TABLE portal.coaching_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.coaching_links FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
