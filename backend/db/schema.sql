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
