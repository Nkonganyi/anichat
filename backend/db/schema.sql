-- AniChat schema — Milestone 2
-- Run with: npm run migrate

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speeds up "get conversation between two users" queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at);

-- AniChat schema — Milestone 4 additions: groups + roles

CREATE TABLE IF NOT EXISTS groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(16) NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  type       VARCHAR(16) NOT NULL DEFAULT 'text', -- 'text' | 'system'
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages (group_id, created_at);

-- AniChat schema — Milestone 5 additions: message types, avatars

ALTER TABLE messages ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'text';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(32) NOT NULL DEFAULT 'sakura';

-- AniChat schema — Milestone 6 addition: per-user UI theme
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(32) NOT NULL DEFAULT 'voyage';

-- AniChat schema — Milestone 7 additions: profile video/audio posts

CREATE TABLE IF NOT EXISTS profile_posts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(16) NOT NULL, -- 'video' | 'audio'
  file_path   TEXT NOT NULL,        -- relative path under /uploads, e.g. 'posts/abc123.mp4'
  caption     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    INTEGER NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         SERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_posts_user ON profile_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at ASC);

-- AniChat schema — Milestone 8 additions: synced group audio playback

CREATE TABLE IF NOT EXISTS group_audio_tracks (
  id          SERIAL PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  title       VARCHAR(120) NOT NULL,
  file_path   TEXT NOT NULL, -- relative path under /uploads, e.g. 'group-audio/abc123.mp3'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per group. This is the server-authoritative playback clock:
-- position at any moment = position_ms_base + (now - server_started_at) while playing,
-- or just position_ms_base while paused/stopped.
CREATE TABLE IF NOT EXISTS group_playback (
  group_id          INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  track_id          INTEGER REFERENCES group_audio_tracks(id) ON DELETE SET NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'stopped', -- 'playing' | 'paused' | 'stopped'
  position_ms_base  INTEGER NOT NULL DEFAULT 0,
  server_started_at TIMESTAMPTZ,
  started_by        INTEGER REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_audio_tracks_group ON group_audio_tracks (group_id, created_at DESC);

-- AniChat schema — Milestone 9 additions: theme-aware system messages + chat list/inbox

-- Structured data for system messages (member_added, member_kicked, etc.) so each
-- viewer can render them in their own active theme's voice, not a fixed sentence.
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS meta JSONB;

-- Tracks, per user per conversation, when they last read it — powers unread counts
-- and the chat list. conversation_id is the OTHER user's id for DMs, or the group id for groups.
CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_type VARCHAR(8) NOT NULL, -- 'dm' | 'group'
  conversation_id   INTEGER NOT NULL,
  last_read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_type, conversation_id)
);

-- AniChat schema — Milestone 10 addition: delivery tracking for DM read receipts
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- AniChat schema — Milestone 11 additions: message editing + delete (for me / for everyone)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- "Delete for me" hides a message from one person's view without affecting
-- anyone else's — message_kind distinguishes which table message_id refers to.
CREATE TABLE IF NOT EXISTS hidden_messages (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_kind VARCHAR(8) NOT NULL, -- 'dm' | 'group'
  message_id   INTEGER NOT NULL,
  hidden_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_kind, message_id)
);

-- AniChat schema — Milestone 12 additions: reply/quote, reactions, and
-- the role-change capability that was always missing (not just its UI).

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES group_messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  id           SERIAL PRIMARY KEY,
  message_kind VARCHAR(8) NOT NULL, -- 'dm' | 'group'
  message_id   INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji        VARCHAR(16) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_kind, message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_lookup ON message_reactions (message_kind, message_id);

-- AniChat schema — Milestone 13 additions: forward, pin, and starred messages

ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from_username VARCHAR(32);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forwarded_from_username VARCHAR(32);
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Personal bookmarks — private to the user, works across any conversation.
CREATE TABLE IF NOT EXISTS starred_messages (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_kind VARCHAR(8) NOT NULL, -- 'dm' | 'group'
  message_id   INTEGER NOT NULL,
  starred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_kind, message_id)
);

-- AniChat schema — Milestone 14: voice messages
-- content stores the relative /uploads path, same pattern as other media message types.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration_seconds INTEGER;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS voice_duration_seconds INTEGER;

-- AniChat schema — Milestone 15: video notes (short circular video messages)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER;

-- AniChat schema — Milestone 16: document/file sharing
-- content stores the relative /uploads path (same pattern as voice/video note),
-- file_name preserves the user's original filename for display since the
-- on-disk filename is a random uuid, file_size_bytes powers the file-card UI.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- AniChat schema — Milestone 17: image/video compression
-- When a shared file is an image or video, `content` points at the
-- compressed/full-resolution version and thumbnail_path points at a
-- small preview (a resized JPEG for images, an extracted frame for
-- videos). video_duration_seconds (added in M15) is reused here for
-- compressed video uploads, not just recorded video notes.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- AniChat schema — Milestone 18: presence (online / last seen)
-- Only written when a user's LAST active socket disconnects (WhatsApp-style
-- semantics) — "online right now" itself is tracked in-memory on the server
-- (see backend/presence.js), not in the DB, since it changes far too often
-- and doesn't need to survive a server restart.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- AniChat schema — Milestone 19: mute a chat
-- muted_until NULL means "muted indefinitely" (until explicitly unmuted);
-- a real timestamp means the mute auto-expires there. Mirrors the
-- starred_messages pattern above — one row per (user, chat), 'dm' rows
-- key off the other user's id, 'group' rows off the group's id.
CREATE TABLE IF NOT EXISTS chat_mutes (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_kind    VARCHAR(8) NOT NULL, -- 'dm' | 'group'
  chat_id      INTEGER NOT NULL,    -- other_user_id for dm, group_id for group
  muted_until  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_kind, chat_id)
);

-- AniChat schema — Milestone 20: archive & delete conversation (for me)
-- Both mirror the chat_mutes pattern above — one row per (user, chat).
--
-- Archiving is a manual, sticky action: a new incoming message does NOT
-- auto-unarchive a chat. That's a deliberate scope call, not an oversight —
-- see the README for this milestone for the reasoning.
CREATE TABLE IF NOT EXISTS chat_archives (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_kind    VARCHAR(8) NOT NULL,
  chat_id      INTEGER NOT NULL,
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_kind, chat_id)
);

-- "Delete conversation" clears history from the requester's own view only —
-- everything created at/before cleared_before is hidden for that user in
-- that chat. Anything created after (including a message they themselves
-- send next) shows up normally with no special-casing needed — the cutoff
-- is just a timestamp, not a per-message flag like M11's hidden_messages.
CREATE TABLE IF NOT EXISTS chat_clears (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_kind      VARCHAR(8) NOT NULL,
  chat_id        INTEGER NOT NULL,
  cleared_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_kind, chat_id)
);

-- AniChat schema — Milestone 21: block a user
-- Directional record (blocker_id blocked blocked_id), but the *effect* is
-- symmetric while it exists: neither side can message the other. Scoped to
-- DMs only — groups aren't affected (see README for this milestone), so a
-- blocked user can still be a co-member of a shared group.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- AniChat schema — Milestone 22: group description/topic
-- A blurb visible to all members, editable by admins/owner only.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT;

-- AniChat schema — Milestone 23: group icon upload
-- NULL means "show the default 👥 emoji" (existing fallback everywhere
-- a group icon renders). Editable by admins/owner only, same as the
-- description above.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS icon_path TEXT;

-- AniChat schema — Milestone 24: invite links
-- A group can have several active invite links at once (each with its own
-- optional expiry / use-cap), same as Discord/Slack — not just one link
-- that gets regenerated. Revocation is soft (revoked_at set, row kept)
-- so admins can see a history of what they've created, not just what's
-- currently live.
CREATE TABLE IF NOT EXISTS group_invites (
  id          SERIAL PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,       -- NULL = never expires
  max_uses    INTEGER,           -- NULL = unlimited uses
  use_count   INTEGER NOT NULL DEFAULT 0,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_invites_group_id ON group_invites(group_id);

-- AniChat schema — Milestone 25: @mentions
-- Only real, current group members can be mentioned — "@foo" in a message
-- only creates a row here if foo is actually in that group at send time.
-- Junction table (not a JSON array column) so unread-mentions counts can
-- be computed with a normal JOIN, same as everything else in this app
-- that needs "unread since my last read marker" math.
CREATE TABLE IF NOT EXISTS group_message_mentions (
  message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_message_mentions_user ON group_message_mentions(user_id);
