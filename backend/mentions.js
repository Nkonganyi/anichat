// @mention parsing — Milestone 25.
//
// Only real, current members of the group can actually be "mentioned" —
// typing "@nobody" or "@someone-who-left" doesn't create a mention record,
// it's just text. This keeps mentions meaningful (and keeps someone from
// spamming a message with plausible-looking @handles for people who
// aren't even in the conversation).

const pool = require("./db/pool");

const MENTION_PATTERN = /@([a-zA-Z0-9_]+)/g;

function extractMentionedUsernames(content) {
  if (!content) return [];
  const matches = new Set();
  let m;
  MENTION_PATTERN.lastIndex = 0;
  while ((m = MENTION_PATTERN.exec(content)) !== null) {
    matches.add(m[1].toLowerCase());
  }
  return [...matches];
}

// Returns [{ id, username }] for every @handle in `content` that matches a
// CURRENT member of groupId. Case-insensitive match against real usernames.
async function resolveMentions(content, groupId) {
  const candidates = extractMentionedUsernames(content);
  if (candidates.length === 0) return [];

  const result = await pool.query(
    `SELECT u.id, u.username
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = $1
     WHERE lower(u.username) = ANY($2::text[])`,
    [groupId, candidates]
  );
  return result.rows;
}

// Replace this message's mention records with a fresh set — used on both
// send and edit, since editing a message can add/remove/change @handles.
async function syncMentions(messageId, groupId, content) {
  const mentions = await resolveMentions(content, groupId);
  await pool.query("DELETE FROM group_message_mentions WHERE message_id = $1", [messageId]);
  if (mentions.length > 0) {
    const values = mentions.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(
      `INSERT INTO group_message_mentions (message_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [messageId, ...mentions.map((m) => m.id)]
    );
  }
  return mentions.map((m) => m.username);
}

module.exports = { resolveMentions, syncMentions };
