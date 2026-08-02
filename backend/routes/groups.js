const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { requireMembership, requireAdmin } = require("../middleware/groupAuth");
const { emitToGroup, emitToUser, joinUserToGroupRoom, removeUserFromGroupRoom } = require("../realtime");
const { resolveMediaFields } = require("../lib/mediaProcessing");

const router = express.Router();

const VOICE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "voice-notes");
fs.mkdirSync(VOICE_UPLOAD_DIR, { recursive: true });
const MAX_VOICE_SIZE = 8 * 1024 * 1024;

const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VOICE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${uuidv4()}${ext}`);
  },
});

function voiceFileFilter(req, file, cb) {
  if (!file.mimetype.startsWith("audio/")) {
    return cb(new Error("only audio recordings are allowed"));
  }
  cb(null, true);
}

const uploadVoice = multer({ storage: voiceStorage, fileFilter: voiceFileFilter, limits: { fileSize: MAX_VOICE_SIZE } });

const VIDEO_NOTE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "video-notes");
fs.mkdirSync(VIDEO_NOTE_UPLOAD_DIR, { recursive: true });
const MAX_VIDEO_NOTE_SIZE = 20 * 1024 * 1024;

const videoNoteStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEO_NOTE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${uuidv4()}${ext}`);
  },
});

function videoNoteFileFilter(req, file, cb) {
  console.log(`[video-note upload] originalname=${file.originalname} mimetype=${file.mimetype}`);
  if (!file.mimetype.startsWith("video/")) {
    return cb(new Error(`only video recordings are allowed (got mimetype: "${file.mimetype}")`));
  }
  cb(null, true);
}

const uploadVideoNote = multer({
  storage: videoNoteStorage,
  fileFilter: videoNoteFileFilter,
  limits: { fileSize: MAX_VIDEO_NOTE_SIZE },
});

const FILE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "files");
fs.mkdirSync(FILE_UPLOAD_DIR, { recursive: true });
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const BLOCKED_FILE_EXTENSIONS = new Set([
  ".exe", ".msi", ".bat", ".cmd", ".sh", ".scr", ".com", ".jar", ".app", ".dll", ".ps1", ".vbs",
]);

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${uuidv4()}${ext}`);
  },
});

function genericFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
    return cb(new Error(`files of type "${ext}" can't be shared`));
  }
  cb(null, true);
}

const uploadFile = multer({
  storage: fileStorage,
  fileFilter: genericFileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// Create a group — creator automatically becomes owner
router.post("/", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "group name is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const groupResult = await client.query(
      "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id, name, created_at",
      [name.trim(), req.user.id]
    );
    const group = groupResult.rows[0];
    await client.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')",
      [group.id, req.user.id]
    );
    await client.query("COMMIT");

    await joinUserToGroupRoom(req.user.id, group.id);

    res.status(201).json({ ...group, role: "owner" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "couldn't create the group" });
  } finally {
    client.release();
  }
});

// List the groups the logged-in user belongs to
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.created_at, gm.role
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({ groups: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load your groups" });
  }
});

// Group detail: members (with roles) + full message history
router.get("/:groupId", requireAuth, requireMembership, async (req, res) => {
  try {
    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.avatar, gm.role
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username`,
      [req.groupId]
    );

    const messagesResult = await pool.query(
      `SELECT gmsg.id, gmsg.sender_id, u.username AS sender_username, gmsg.type, gmsg.meta,
              gmsg.edited_at, gmsg.deleted_at, gmsg.pinned_at, gmsg.forwarded_from_username,
              gmsg.voice_duration_seconds, gmsg.video_duration_seconds,
              gmsg.file_name, gmsg.file_size_bytes, gmsg.thumbnail_path, gmsg.created_at,
              CASE WHEN gmsg.deleted_at IS NULL THEN gmsg.content ELSE NULL END AS content,
              rq.id AS reply_id, rq.type AS reply_type, rq.deleted_at AS reply_deleted_at,
              CASE WHEN rq.deleted_at IS NULL THEN rq.content ELSE NULL END AS reply_content,
              ru.username AS reply_sender_username,
              s.user_id IS NOT NULL AS starred_by_me
       FROM group_messages gmsg
       JOIN users u ON u.id = gmsg.sender_id
       LEFT JOIN hidden_messages h ON h.message_kind = 'group' AND h.message_id = gmsg.id AND h.user_id = $2
       LEFT JOIN group_messages rq ON rq.id = gmsg.reply_to_id
       LEFT JOIN users ru ON ru.id = rq.sender_id
       LEFT JOIN starred_messages s ON s.message_kind = 'group' AND s.message_id = gmsg.id AND s.user_id = $2
       WHERE gmsg.group_id = $1 AND h.message_id IS NULL
       ORDER BY gmsg.created_at ASC`,
      [req.groupId, req.user.id]
    );

    const messages = messagesResult.rows.map((row) => ({
      id: row.id,
      sender_id: row.sender_id,
      sender_username: row.sender_username,
      type: row.type,
      meta: row.meta,
      content: row.content,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      pinned_at: row.pinned_at,
      forwarded_from_username: row.forwarded_from_username,
      voice_duration_seconds: row.voice_duration_seconds,
      video_duration_seconds: row.video_duration_seconds,
      file_name: row.file_name,
      file_size_bytes: row.file_size_bytes,
      thumbnail_path: row.thumbnail_path,
      starred_by_me: row.starred_by_me,
      created_at: row.created_at,
      replyTo: row.reply_id
        ? {
            id: row.reply_id,
            type: row.reply_type,
            content: row.reply_content,
            deleted: !!row.reply_deleted_at,
            senderUsername: row.reply_sender_username,
          }
        : null,
    }));

    if (messages.length > 0) {
      const reactionsResult = await pool.query(
        `SELECT message_id, emoji, COUNT(*)::int AS count, ARRAY_AGG(user_id) AS user_ids
         FROM message_reactions
         WHERE message_kind = 'group' AND message_id = ANY($1::int[])
         GROUP BY message_id, emoji`,
        [messages.map((m) => m.id)]
      );
      const reactionsByMessage = new Map();
      for (const r of reactionsResult.rows) {
        if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, []);
        reactionsByMessage.get(r.message_id).push({ emoji: r.emoji, count: r.count, userIds: r.user_ids });
      }
      for (const m of messages) {
        m.reactions = reactionsByMessage.get(m.id) || [];
      }
    }

    const groupResult = await pool.query("SELECT id, name, created_at FROM groups WHERE id = $1", [req.groupId]);

    const muteResult = await pool.query(
      "SELECT muted_until FROM chat_mutes WHERE user_id = $1 AND chat_kind = 'group' AND chat_id = $2 AND (muted_until IS NULL OR muted_until > now())",
      [req.user.id, req.groupId]
    );

    res.json({
      group: groupResult.rows[0],
      myRole: req.membershipRole,
      members: membersResult.rows,
      messages,
      muted: muteResult.rows.length > 0,
      mutedUntil: muteResult.rows[0]?.muted_until || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load this group" });
  }
});

const VALID_MSG_TYPES = ["text", "sticker", "gif", "voice", "video_note", "file", "image", "video"];
const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Send a message to the group — any member can do this
router.post("/:groupId/messages", requireAuth, requireMembership, async (req, res) => {
  const { content, type = "text", replyToId } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }
  if (!VALID_MSG_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_MSG_TYPES.join(", ")}` });
  }

  try {
    let replyTo = null;
    if (replyToId) {
      const rq = await pool.query(
        `SELECT rq.id, rq.type, rq.deleted_at,
                CASE WHEN rq.deleted_at IS NULL THEN rq.content ELSE NULL END AS content,
                u.username AS sender_username
         FROM group_messages rq
         JOIN users u ON u.id = rq.sender_id
         WHERE rq.id = $1 AND rq.group_id = $2`,
        [replyToId, req.groupId]
      );
      if (rq.rows.length === 0) {
        return res.status(400).json({ error: "the message you're replying to isn't in this group" });
      }
      const r = rq.rows[0];
      replyTo = { id: r.id, type: r.type, content: r.content, deleted: !!r.deleted_at, senderUsername: r.sender_username };
    }

    const result = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, type, content, reply_to_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_id, type, content, reply_to_id, created_at`,
      [req.groupId, req.user.id, type, content.trim(), replyTo?.id || null]
    );
    const message = { ...result.rows[0], sender_username: req.user.username, group_id: req.groupId, replyTo };

    emitToGroup(req.groupId, "group_message:new", message);

    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't send that message" });
  }
});

// Send a voice message to the group — multipart upload
router.post("/:groupId/messages/voice", requireAuth, requireMembership, (req, res) => {
  uploadVoice.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "voice message is too large — max 8MB (keep it under ~3 minutes)" });
    }
    if (err) return res.status(400).json({ error: err.message || "upload failed" });
    if (!req.file) return res.status(400).json({ error: "an audio recording is required (field name: 'file')" });

    const durationSeconds = parseInt(req.body.durationSeconds, 10) || null;
    const { replyToId } = req.body;

    try {
      let validReplyToId = null;
      if (replyToId) {
        const rq = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
          replyToId,
          req.groupId,
        ]);
        if (rq.rows.length > 0) validReplyToId = replyToId;
      }

      const relativePath = `voice-notes/${req.file.filename}`;
      const result = await pool.query(
        `INSERT INTO group_messages (group_id, sender_id, type, content, reply_to_id, voice_duration_seconds)
         VALUES ($1, $2, 'voice', $3, $4, $5)
         RETURNING id, sender_id, type, content, reply_to_id, voice_duration_seconds, created_at`,
        [req.groupId, req.user.id, relativePath, validReplyToId, durationSeconds]
      );
      const message = { ...result.rows[0], sender_username: req.user.username, group_id: req.groupId };
      emitToGroup(req.groupId, "group_message:new", message);
      res.status(201).json(message);
    } catch (dbErr) {
      console.error(dbErr);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: "couldn't send voice message" });
    }
  });
});

// Send a video note to the group — short circular video message
router.post("/:groupId/messages/video-note", requireAuth, requireMembership, (req, res) => {
  uploadVideoNote.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "video note is too large — max 20MB (keep it under ~60 seconds)" });
    }
    if (err) return res.status(400).json({ error: err.message || "upload failed" });
    if (!req.file) return res.status(400).json({ error: "a video recording is required (field name: 'file')" });

    const durationSeconds = parseInt(req.body.durationSeconds, 10) || null;
    const { replyToId } = req.body;

    try {
      let validReplyToId = null;
      if (replyToId) {
        const rq = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
          replyToId,
          req.groupId,
        ]);
        if (rq.rows.length > 0) validReplyToId = replyToId;
      }

      const relativePath = `video-notes/${req.file.filename}`;
      const result = await pool.query(
        `INSERT INTO group_messages (group_id, sender_id, type, content, reply_to_id, video_duration_seconds)
         VALUES ($1, $2, 'video_note', $3, $4, $5)
         RETURNING id, sender_id, type, content, reply_to_id, video_duration_seconds, created_at`,
        [req.groupId, req.user.id, relativePath, validReplyToId, durationSeconds]
      );
      const message = { ...result.rows[0], sender_username: req.user.username, group_id: req.groupId };
      emitToGroup(req.groupId, "group_message:new", message);
      res.status(201).json(message);
    } catch (dbErr) {
      console.error(dbErr);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: "couldn't send video note" });
    }
  });
});

// Send a document/file to the group — multipart upload, field name "file"
router.post("/:groupId/messages/file", requireAuth, requireMembership, (req, res) => {
  uploadFile.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file is too large — max 25MB" });
    }
    if (err) return res.status(400).json({ error: err.message || "upload failed" });
    if (!req.file) return res.status(400).json({ error: "a file is required (field name: 'file')" });

    const { replyToId } = req.body;

    try {
      let validReplyToId = null;
      if (replyToId) {
        const rq = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
          replyToId,
          req.groupId,
        ]);
        if (rq.rows.length > 0) validReplyToId = replyToId;
      }

      const media = await resolveMediaFields(req.file);

      const result = await pool.query(
        `INSERT INTO group_messages (group_id, sender_id, type, content, reply_to_id, file_name, file_size_bytes, thumbnail_path, video_duration_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, sender_id, type, content, reply_to_id, file_name, file_size_bytes, thumbnail_path, video_duration_seconds, created_at`,
        [
          req.groupId,
          req.user.id,
          media.type,
          media.relativeContentPath,
          validReplyToId,
          media.fileName,
          media.fileSizeBytes,
          media.relativeThumbnailPath,
          media.durationSeconds,
        ]
      );
      const message = { ...result.rows[0], sender_username: req.user.username, group_id: req.groupId };
      emitToGroup(req.groupId, "group_message:new", message);
      res.status(201).json(message);
    } catch (dbErr) {
      console.error(dbErr);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: "couldn't send that file" });
    }
  });
});

// Edit a group message — sender only, text messages only
router.patch("/:groupId/messages/:messageId", requireAuth, requireMembership, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  try {
    const existing = await pool.query("SELECT * FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });
    if (message.sender_id !== req.user.id) {
      return res.status(403).json({ error: "you can only edit your own messages" });
    }
    if (message.type !== "text") {
      return res.status(400).json({ error: "only text messages can be edited" });
    }
    if (message.deleted_at) {
      return res.status(400).json({ error: "can't edit a deleted message" });
    }

    const result = await pool.query(
      "UPDATE group_messages SET content = $1, edited_at = now() WHERE id = $2 RETURNING content, edited_at",
      [content.trim(), messageId]
    );

    const payload = {
      groupId: req.groupId,
      messageId,
      content: result.rows[0].content,
      editedAt: result.rows[0].edited_at,
    };
    emitToGroup(req.groupId, "group_message:edited", payload);

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't edit that message" });
  }
});

// Delete a group message — "me" hides it from just your own view (?mode=me, default).
// "everyone" tombstones it for the whole group — allowed for the original sender,
// OR a group admin/owner as a moderation action.
router.delete("/:groupId/messages/:messageId", requireAuth, requireMembership, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });
  const mode = req.query.mode === "everyone" ? "everyone" : "me";

  try {
    const existing = await pool.query("SELECT * FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });

    if (mode === "me") {
      await pool.query(
        `INSERT INTO hidden_messages (user_id, message_kind, message_id)
         VALUES ($1, 'group', $2) ON CONFLICT DO NOTHING`,
        [req.user.id, messageId]
      );
      return res.json({ deleted: messageId, mode: "me" });
    }

    // mode === "everyone"
    const isOwnMessage = message.sender_id === req.user.id;
    const isModerator = req.membershipRole === "owner" || req.membershipRole === "admin";
    if (!isOwnMessage && !isModerator) {
      return res.status(403).json({ error: "only the sender or a group admin can delete this for everyone" });
    }

    const result = await pool.query(
      "UPDATE group_messages SET deleted_at = now() WHERE id = $1 RETURNING deleted_at",
      [messageId]
    );

    const payload = { groupId: req.groupId, messageId, deletedAt: result.rows[0].deleted_at };
    emitToGroup(req.groupId, "group_message:deleted", payload);

    res.json({ deleted: messageId, mode: "everyone" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't delete that message" });
  }
});

// Toggle a quick emoji reaction on a group message
router.post("/:groupId/messages/:messageId/reactions", requireAuth, requireMembership, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { emoji } = req.body;
  if (!ALLOWED_REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: `emoji must be one of: ${ALLOWED_REACTIONS.join(" ")}` });
  }

  try {
    const msgResult = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    if (msgResult.rows.length === 0) return res.status(404).json({ error: "message not found" });

    const existing = await pool.query(
      "SELECT 1 FROM message_reactions WHERE message_kind = 'group' AND message_id = $1 AND user_id = $2 AND emoji = $3",
      [messageId, req.user.id, emoji]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        "DELETE FROM message_reactions WHERE message_kind = 'group' AND message_id = $1 AND user_id = $2 AND emoji = $3",
        [messageId, req.user.id, emoji]
      );
    } else {
      await pool.query(
        "INSERT INTO message_reactions (message_kind, message_id, user_id, emoji) VALUES ('group', $1, $2, $3)",
        [messageId, req.user.id, emoji]
      );
    }

    const agg = await pool.query(
      `SELECT emoji, COUNT(*)::int AS count, ARRAY_AGG(user_id) AS user_ids
       FROM message_reactions WHERE message_kind = 'group' AND message_id = $1 GROUP BY emoji`,
      [messageId]
    );

    const payload = {
      groupId: req.groupId,
      messageId,
      reactions: agg.rows.map((r) => ({ emoji: r.emoji, count: r.count, userIds: r.user_ids })),
    };
    emitToGroup(req.groupId, "group_message:reaction", payload);

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update reaction" });
  }
});

// Forward a group message into a DM or another group
router.post("/:groupId/messages/:messageId/forward", requireAuth, requireMembership, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { toUsername, toGroupId } = req.body;
  if (!toUsername && !toGroupId) return res.status(400).json({ error: "provide toUsername or toGroupId" });
  if (toUsername && toGroupId) return res.status(400).json({ error: "provide only one of toUsername or toGroupId" });

  try {
    const sourceResult = await pool.query(
      `SELECT gm.*, u.username AS sender_username FROM group_messages gm JOIN users u ON u.id = gm.sender_id
       WHERE gm.id = $1 AND gm.group_id = $2`,
      [messageId, req.groupId]
    );
    const source = sourceResult.rows[0];
    if (!source) return res.status(404).json({ error: "message not found" });
    if (source.deleted_at) return res.status(400).json({ error: "can't forward a deleted message" });
    if (source.type === "system") return res.status(400).json({ error: "can't forward a system message" });

    if (toUsername) {
      const receiverResult = await pool.query("SELECT id FROM users WHERE username = $1", [toUsername]);
      const receiver = receiverResult.rows[0];
      if (!receiver) return res.status(404).json({ error: `no user named '${toUsername}'` });
      if (receiver.id === req.user.id) return res.status(400).json({ error: "you can't message yourself" });

      const result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, type, forwarded_from_username)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sender_id, receiver_id, content, type, forwarded_from_username, delivered_at, created_at`,
        [req.user.id, receiver.id, source.content, source.type, source.sender_username]
      );
      const message = result.rows[0];
      emitToUser(receiver.id, "message:new", message);
      emitToUser(req.user.id, "message:new", message);
      return res.status(201).json(message);
    }

    const targetGroupId = parseInt(toGroupId, 10);
    const memberCheck = await pool.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [
      targetGroupId,
      req.user.id,
    ]);
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: "you're not a member of that group" });

    const result = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, content, type, forwarded_from_username)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_id, content, type, forwarded_from_username, created_at`,
      [targetGroupId, req.user.id, source.content, source.type, source.sender_username]
    );
    const message = { ...result.rows[0], sender_username: req.user.username, group_id: targetGroupId };
    emitToGroup(targetGroupId, "group_message:new", message);
    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't forward that message" });
  }
});

// Pin / unpin — admin/owner only, this is a shared "important for the group" signal
router.post("/:groupId/messages/:messageId/pin", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "message not found" });

    const result = await pool.query(
      "UPDATE group_messages SET pinned_at = now() WHERE id = $1 RETURNING pinned_at",
      [messageId]
    );
    const payload = { groupId: req.groupId, messageId, pinnedAt: result.rows[0].pinned_at };
    emitToGroup(req.groupId, "group_message:pinned", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't pin that message" });
  }
});

router.post("/:groupId/messages/:messageId/unpin", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "message not found" });

    await pool.query("UPDATE group_messages SET pinned_at = NULL WHERE id = $1", [messageId]);
    const payload = { groupId: req.groupId, messageId };
    emitToGroup(req.groupId, "group_message:unpinned", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unpin that message" });
  }
});

// Star / bookmark — toggle, private to the user
router.post("/:groupId/messages/:messageId/star", requireAuth, requireMembership, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT id FROM group_messages WHERE id = $1 AND group_id = $2", [
      messageId,
      req.groupId,
    ]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "message not found" });

    const already = await pool.query(
      "SELECT 1 FROM starred_messages WHERE user_id = $1 AND message_kind = 'group' AND message_id = $2",
      [req.user.id, messageId]
    );
    if (already.rows.length > 0) {
      await pool.query(
        "DELETE FROM starred_messages WHERE user_id = $1 AND message_kind = 'group' AND message_id = $2",
        [req.user.id, messageId]
      );
      return res.json({ messageId, starred: false });
    }
    await pool.query("INSERT INTO starred_messages (user_id, message_kind, message_id) VALUES ($1, 'group', $2)", [
      req.user.id,
      messageId,
    ]);
    res.json({ messageId, starred: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update starred status" });
  }
});

// Change a member's role — owner only. This is what was actually missing
// since Milestone 4: not just a UI button, the capability itself never
// existed anywhere in the API before now.
router.patch("/:groupId/members/:username/role", requireAuth, requireMembership, async (req, res) => {
  if (req.membershipRole !== "owner") {
    return res.status(403).json({ error: "only the group owner can change member roles" });
  }

  const { role } = req.body;
  if (!["admin", "member"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'member'" });
  }

  try {
    const targetResult = await pool.query(
      `SELECT u.id, u.username, gm.role
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND u.username = $2`,
      [req.groupId, req.params.username]
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: "that user isn't in this group" });
    if (target.role === "owner") {
      return res.status(400).json({ error: "the owner's role can't be changed this way" });
    }
    if (target.role === role) {
      return res.status(400).json({ error: `${target.username} is already ${role === "admin" ? "an" : "a"} ${role}` });
    }

    await pool.query("UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3", [
      role,
      req.groupId,
      target.id,
    ]);

    const eventType = role === "admin" ? "member_promoted" : "member_demoted";
    const verb = role === "admin" ? "promoted to admin" : "demoted to member";
    const sysMsgResult = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, type, content, meta)
       VALUES ($1, $2, 'system', $3, $4)
       RETURNING id, sender_id, type, content, meta, created_at`,
      [
        req.groupId,
        req.user.id,
        `${target.username} was ${verb} by ${req.user.username}`,
        JSON.stringify({ eventType, actorUsername: req.user.username, targetUsername: target.username }),
      ]
    );

    emitToGroup(req.groupId, "group:event", {
      type: eventType,
      groupId: req.groupId,
      actorUsername: req.user.username,
      targetUsername: target.username,
      message: sysMsgResult.rows[0],
    });
    emitToGroup(req.groupId, "group:role_changed", { groupId: req.groupId, username: target.username, role });

    res.json({ username: target.username, role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't change that member's role" });
  }
});

// Add a member — admin/owner only, enforced server-side via requireAdmin
router.post("/:groupId/members", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }

  try {
    const userResult = await pool.query("SELECT id, username FROM users WHERE username = $1", [username]);
    const targetUser = userResult.rows[0];
    if (!targetUser) {
      return res.status(404).json({ error: `no user named '${username}'` });
    }

    const existing = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
      [req.groupId, targetUser.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `${username} is already in this group` });
    }

    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')",
      [req.groupId, targetUser.id]
    );

    const sysMsgResult = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, type, content, meta)
       VALUES ($1, $2, 'system', $3, $4)
       RETURNING id, sender_id, type, content, meta, created_at`,
      [
        req.groupId,
        req.user.id,
        `${targetUser.username} was added by ${req.user.username}`,
        JSON.stringify({ eventType: "member_added", actorUsername: req.user.username, targetUsername: targetUser.username }),
      ]
    );

    // Join their live sockets to the room BEFORE broadcasting, so they
    // receive the "you were added" event themselves in real time.
    await joinUserToGroupRoom(targetUser.id, req.groupId);

    emitToGroup(req.groupId, "group:event", {
      type: "member_added",
      groupId: req.groupId,
      actorUsername: req.user.username,
      targetUsername: targetUser.username,
      message: sysMsgResult.rows[0],
    });

    res.status(201).json({ added: targetUser.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't add that member" });
  }
});

// Remove (kick) a member — admin/owner only. Owner can't be removed.
// Admins can't remove other admins — only the owner can.
router.delete("/:groupId/members/:username", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  try {
    const targetResult = await pool.query(
      `SELECT u.id, u.username, gm.role
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND u.username = $2`,
      [req.groupId, req.params.username]
    );
    const target = targetResult.rows[0];
    if (!target) {
      return res.status(404).json({ error: "that user isn't in this group" });
    }
    if (target.role === "owner") {
      return res.status(403).json({ error: "the group owner can't be removed" });
    }
    if (target.role === "admin" && req.membershipRole !== "owner") {
      return res.status(403).json({ error: "only the owner can remove an admin" });
    }

    await pool.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [req.groupId, target.id]);

    const sysMsgResult = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, type, content, meta)
       VALUES ($1, $2, 'system', $3, $4)
       RETURNING id, sender_id, type, content, meta, created_at`,
      [
        req.groupId,
        req.user.id,
        `${target.username} was removed by ${req.user.username}`,
        JSON.stringify({ eventType: "member_kicked", actorUsername: req.user.username, targetUsername: target.username }),
      ]
    );

    // Broadcast BEFORE removing them from the room, so their own client
    // still receives the "you were kicked" event to react to.
    emitToGroup(req.groupId, "group:event", {
      type: "member_kicked",
      groupId: req.groupId,
      actorUsername: req.user.username,
      targetUsername: target.username,
      message: sysMsgResult.rows[0],
    });

    await removeUserFromGroupRoom(target.id, req.groupId);

    res.json({ removed: target.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't remove that member" });
  }
});

// Mark a group as read up to now — powers unread counts in the chat list
router.post("/:groupId/read", requireAuth, requireMembership, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO conversation_reads (user_id, conversation_type, conversation_id, last_read_at)
       VALUES ($1, 'group', $2, now())
       ON CONFLICT (user_id, conversation_type, conversation_id)
       DO UPDATE SET last_read_at = now()`,
      [req.user.id, req.groupId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't mark group as read" });
  }
});

module.exports = router;
