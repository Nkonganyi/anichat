// Invite link preview + join — Milestone 24.
//
// Split out from routes/groups.js on purpose: these two endpoints are
// reachable by ANY authenticated user with a valid token, not gated by
// requireMembership like everything else under /api/groups/:groupId/*.
// Someone previewing or using an invite link, by definition, isn't a
// member of the group yet.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { emitToGroup, joinUserToGroupRoom } = require("../realtime");

const router = express.Router();

async function loadInviteWithValidity(token) {
  const result = await pool.query(
    `SELECT gi.id, gi.group_id, gi.expires_at, gi.max_uses, gi.use_count, gi.revoked_at,
            g.name AS group_name, g.description AS group_description, g.icon_path AS group_icon_path
     FROM group_invites gi
     JOIN groups g ON g.id = gi.group_id
     WHERE gi.token = $1`,
    [token]
  );
  const invite = result.rows[0];
  if (!invite) return { invite: null, reason: "not_found" };
  if (invite.revoked_at) return { invite, reason: "revoked" };
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { invite, reason: "expired" };
  if (invite.max_uses != null && invite.use_count >= invite.max_uses) return { invite, reason: "exhausted" };
  return { invite, reason: null };
}

// Preview what you're about to join, before committing — group name,
// description, icon, member count, and whether the link is actually still
// usable. Doesn't require group membership (obviously) but does require
// being logged in, consistent with the rest of the app not exposing any
// data to fully anonymous requests.
router.get("/:token", requireAuth, async (req, res) => {
  try {
    const { invite, reason } = await loadInviteWithValidity(req.params.token);
    if (!invite) return res.status(404).json({ error: "that invite link doesn't exist" });

    const memberCountResult = await pool.query("SELECT COUNT(*) FROM group_members WHERE group_id = $1", [
      invite.group_id,
    ]);
    const alreadyMemberResult = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
      [invite.group_id, req.user.id]
    );

    res.json({
      valid: reason === null,
      reason,
      alreadyMember: alreadyMemberResult.rows.length > 0,
      group: {
        id: invite.group_id,
        name: invite.group_name,
        description: invite.group_description,
        icon_path: invite.group_icon_path,
        memberCount: parseInt(memberCountResult.rows[0].count, 10),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load that invite link" });
  }
});

router.post("/:token/join", requireAuth, async (req, res) => {
  try {
    const { invite, reason } = await loadInviteWithValidity(req.params.token);
    if (!invite) return res.status(404).json({ error: "that invite link doesn't exist" });

    const groupId = invite.group_id;

    // Check membership FIRST, before enforcing expiry/use-limit/revocation —
    // those checks exist to gate *new* joins, not to lock out someone who's
    // already in the group from using the same link as a quick way back
    // (e.g. they bookmarked it). Only block on an invalid link if this
    // would actually be a new join.
    const alreadyMember = await pool.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [
      groupId,
      req.user.id,
    ]);
    if (alreadyMember.rows.length > 0) {
      const groupResult = await pool.query("SELECT id, name FROM groups WHERE id = $1", [groupId]);
      return res.json({ joined: true, alreadyMember: true, group: groupResult.rows[0] });
    }

    if (reason) {
      const messages = {
        revoked: "this invite link has been revoked",
        expired: "this invite link has expired",
        exhausted: "this invite link has reached its use limit",
      };
      return res.status(410).json({ error: messages[reason] });
    }

    await pool.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [
      groupId,
      req.user.id,
    ]);
    await pool.query("UPDATE group_invites SET use_count = use_count + 1 WHERE id = $1", [invite.id]);

    const sysMsgResult = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, type, content, meta)
       VALUES ($1, $2, 'system', $3, $4)
       RETURNING id, sender_id, type, content, meta, created_at`,
      [
        groupId,
        req.user.id,
        `${req.user.username} joined via invite link`,
        JSON.stringify({ eventType: "member_joined_via_invite", targetUsername: req.user.username }),
      ]
    );

    // Join their live sockets to the room BEFORE broadcasting, so they
    // receive the "you joined" event themselves in real time — same
    // ordering as the admin-adds-a-member flow in routes/groups.js.
    await joinUserToGroupRoom(req.user.id, groupId);

    emitToGroup(groupId, "group:event", {
      type: "member_joined_via_invite",
      groupId,
      targetUsername: req.user.username,
      message: sysMsgResult.rows[0],
    });

    const groupResult = await pool.query("SELECT id, name FROM groups WHERE id = $1", [groupId]);
    res.status(201).json({ joined: true, alreadyMember: false, group: groupResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't join that group" });
  }
});

module.exports = router;
