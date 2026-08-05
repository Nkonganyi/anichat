const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const presence = require("../presence");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    // ---- DMs: last message per distinct conversation partner ----
    // The LEFT JOIN against chat_clears means a "deleted" conversation with
    // no messages since the clear point simply produces zero rows for that
    // partner via the (inner) messages JOIN below — it just disappears
    // until a new message arrives, no separate "hide this DM" flag needed.
    const dmLastMessages = await pool.query(
      `WITH dm_partners AS (
         SELECT DISTINCT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id
         FROM messages
         WHERE sender_id = $1 OR receiver_id = $1
       )
       SELECT DISTINCT ON (dp.other_user_id)
         dp.other_user_id, u.username, u.avatar, u.last_seen_at,
         m.content, m.type, m.created_at, m.sender_id
       FROM dm_partners dp
       JOIN users u ON u.id = dp.other_user_id
       LEFT JOIN chat_clears cc ON cc.user_id = $1 AND cc.chat_kind = 'dm' AND cc.chat_id = dp.other_user_id
       JOIN messages m ON
         ((m.sender_id = $1 AND m.receiver_id = dp.other_user_id) OR
          (m.sender_id = dp.other_user_id AND m.receiver_id = $1))
         AND m.created_at > COALESCE(cc.cleared_before, 'epoch')
       ORDER BY dp.other_user_id, m.created_at DESC`,
      [userId]
    );

    // ---- DM unread counts: messages received after my last_read_at for that partner ----
    const dmUnread = await pool.query(
      `SELECT m.sender_id AS other_user_id, COUNT(*)::int AS unread_count
       FROM messages m
       LEFT JOIN conversation_reads cr
         ON cr.user_id = $1 AND cr.conversation_type = 'dm' AND cr.conversation_id = m.sender_id
       WHERE m.receiver_id = $1 AND m.created_at > COALESCE(cr.last_read_at, 'epoch')
       GROUP BY m.sender_id`,
      [userId]
    );
    const dmUnreadMap = new Map(dmUnread.rows.map((r) => [r.other_user_id, r.unread_count]));

    // ---- Groups: last message per group I'm in ----
    // Unlike DMs (derived purely from message existence), group membership
    // is a persistent thing — a cleared group stays in the list (you're
    // still a member) but shows no last-message preview until a new one
    // arrives after the clear point.
    const groupLastMessages = await pool.query(
      `SELECT DISTINCT ON (g.id)
         g.id AS group_id, g.name, g.icon_path,
         gmsg.content, gmsg.type, gmsg.created_at, gmsg.sender_id, su.username AS sender_username
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN chat_clears cc ON cc.user_id = $1 AND cc.chat_kind = 'group' AND cc.chat_id = g.id
       LEFT JOIN group_messages gmsg ON gmsg.group_id = g.id AND gmsg.created_at > COALESCE(cc.cleared_before, 'epoch')
       LEFT JOIN users su ON su.id = gmsg.sender_id
       WHERE gm.user_id = $1
       ORDER BY g.id, gmsg.created_at DESC NULLS LAST`,
      [userId]
    );

    // ---- Group unread counts: messages from others after my last_read_at for that group ----
    const groupUnread = await pool.query(
      `SELECT gmsg.group_id, COUNT(*)::int AS unread_count
       FROM group_messages gmsg
       JOIN group_members gm ON gm.group_id = gmsg.group_id AND gm.user_id = $1
       LEFT JOIN conversation_reads cr
         ON cr.user_id = $1 AND cr.conversation_type = 'group' AND cr.conversation_id = gmsg.group_id
       WHERE gmsg.sender_id != $1 AND gmsg.created_at > COALESCE(cr.last_read_at, 'epoch')
       GROUP BY gmsg.group_id`,
      [userId]
    );
    const groupUnreadMap = new Map(groupUnread.rows.map((r) => [r.group_id, r.unread_count]));

    // ---- Unread @mentions per group: same "since my last read marker"
    // math as unread counts above, just scoped to messages that actually
    // mention me specifically ----
    const groupMentions = await pool.query(
      `SELECT gmsg.group_id, COUNT(*)::int AS mention_count
       FROM group_message_mentions gmm
       JOIN group_messages gmsg ON gmsg.id = gmm.message_id
       LEFT JOIN conversation_reads cr
         ON cr.user_id = $1 AND cr.conversation_type = 'group' AND cr.conversation_id = gmsg.group_id
       WHERE gmm.user_id = $1 AND gmsg.created_at > COALESCE(cr.last_read_at, 'epoch')
       GROUP BY gmsg.group_id`,
      [userId]
    );
    const groupMentionMap = new Map(groupMentions.rows.map((r) => [r.group_id, r.mention_count]));

    // ---- Mutes: one query covers both DM and group mutes for this user ----
    const mutes = await pool.query(
      "SELECT chat_kind, chat_id, muted_until FROM chat_mutes WHERE user_id = $1 AND (muted_until IS NULL OR muted_until > now())",
      [userId]
    );
    const muteMap = new Map(mutes.rows.map((r) => [`${r.chat_kind}:${r.chat_id}`, r.muted_until]));

    // ---- Archives: same shape as mutes ----
    const archives = await pool.query("SELECT chat_kind, chat_id, archived_at FROM chat_archives WHERE user_id = $1", [
      userId,
    ]);
    const archiveMap = new Map(archives.rows.map((r) => [`${r.chat_kind}:${r.chat_id}`, r.archived_at]));

    // ---- Blocks: DM-only, both directions matter for the UI (blocked
    // someone vs. been blocked by them read differently even though
    // messaging is closed either way) ----
    const blocks = await pool.query(
      "SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1",
      [userId]
    );
    const blockedByMeSet = new Set(blocks.rows.filter((r) => r.blocker_id === userId).map((r) => r.blocked_id));
    const blockedMeSet = new Set(blocks.rows.filter((r) => r.blocked_id === userId).map((r) => r.blocker_id));

    const dmConversations = dmLastMessages.rows.map((row) => ({
      kind: "dm",
      id: row.other_user_id,
      username: row.username,
      avatar: row.avatar,
      online: presence.isOnline(row.other_user_id),
      lastSeenAt: presence.isOnline(row.other_user_id) ? null : row.last_seen_at,
      lastMessage: { content: row.content, type: row.type, senderId: row.sender_id },
      lastActivityAt: row.created_at,
      unreadCount: dmUnreadMap.get(row.other_user_id) || 0,
      muted: muteMap.has(`dm:${row.other_user_id}`),
      mutedUntil: muteMap.get(`dm:${row.other_user_id}`) || null,
      archived: archiveMap.has(`dm:${row.other_user_id}`),
      blockedByMe: blockedByMeSet.has(row.other_user_id),
      blockedMe: blockedMeSet.has(row.other_user_id),
    }));

    const groupConversations = groupLastMessages.rows.map((row) => ({
      kind: "group",
      id: row.group_id,
      name: row.name,
      iconPath: row.icon_path,
      lastMessage: row.content
        ? { content: row.content, type: row.type, senderUsername: row.sender_username }
        : null,
      lastActivityAt: row.created_at,
      unreadCount: groupUnreadMap.get(row.group_id) || 0,
      mentionCount: groupMentionMap.get(row.group_id) || 0,
      muted: muteMap.has(`group:${row.group_id}`),
      mutedUntil: muteMap.get(`group:${row.group_id}`) || null,
      archived: archiveMap.has(`group:${row.group_id}`),
    }));

    // Default view excludes archived chats; ?archived=true flips it to show
    // ONLY the archived ones, for a dedicated "Archived" list in the UI.
    const wantArchived = req.query.archived === "true";
    const filteredDm = dmConversations.filter((c) => c.archived === wantArchived);
    const filteredGroups = groupConversations.filter((c) => c.archived === wantArchived);

    const conversations = [...filteredDm, ...filteredGroups].sort((a, b) => {
      // Groups/DMs with no messages yet sort to the bottom (by null lastActivityAt)
      if (!a.lastActivityAt && !b.lastActivityAt) return 0;
      if (!a.lastActivityAt) return 1;
      if (!b.lastActivityAt) return -1;
      return new Date(b.lastActivityAt) - new Date(a.lastActivityAt);
    });

    res.json({ conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load your conversations" });
  }
});

module.exports = router;
