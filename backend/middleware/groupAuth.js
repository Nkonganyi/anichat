const pool = require("../db/pool");

// Confirms the logged-in user is actually a member of :groupId,
// and attaches their role so downstream handlers/middleware can use it.
async function requireMembership(req, res, next) {
  const groupId = parseInt(req.params.groupId, 10);
  if (Number.isNaN(groupId)) {
    return res.status(400).json({ error: "invalid group id" });
  }

  try {
    const result = await pool.query(
      "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: "you're not a member of this group" });
    }
    req.groupId = groupId;
    req.membershipRole = result.rows[0].role;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't verify group membership" });
  }
}

// Must run after requireMembership. Blocks anyone who isn't owner/admin —
// this is the actual enforcement, not just a hidden button in the UI.
function requireAdmin(req, res, next) {
  if (req.membershipRole !== "owner" && req.membershipRole !== "admin") {
    return res.status(403).json({ error: "only group admins can do that" });
  }
  next();
}

module.exports = { requireMembership, requireAdmin };
