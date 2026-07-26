const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { requireMembership, requireAdmin } = require("../middleware/groupAuth");
const { emitToGroup } = require("../realtime");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "group-audio");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_SIZE = 15 * 1024 * 1024; // shorter clips than profile posts — this is meant for music-length tracks

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp3";
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith("audio/")) {
    return cb(new Error("only audio files can be added to a group's playback library"));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

// ---- track library (upload doesn't start playback — that's a separate step) ----

router.post("/:groupId/audio-tracks", requireAuth, requireMembership, requireAdmin, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file is too large — max 15MB" });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "an audio file is required (field name: 'file')" });
    }

    const title = (req.body.title || req.file.originalname || "Untitled track").slice(0, 120);
    const relativePath = `group-audio/${req.file.filename}`;

    try {
      const result = await pool.query(
        `INSERT INTO group_audio_tracks (group_id, uploaded_by, title, file_path)
         VALUES ($1, $2, $3, $4)
         RETURNING id, group_id, uploaded_by, title, file_path, created_at`,
        [req.groupId, req.user.id, title, relativePath]
      );
      res.status(201).json(result.rows[0]);
    } catch (dbErr) {
      console.error(dbErr);
      fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
      res.status(500).json({ error: "couldn't save the track" });
    }
  });
});

router.get("/:groupId/audio-tracks", requireAuth, requireMembership, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.file_path, t.created_at, u.username AS uploaded_by_username
       FROM group_audio_tracks t
       JOIN users u ON u.id = t.uploaded_by
       WHERE t.group_id = $1
       ORDER BY t.created_at DESC`,
      [req.groupId]
    );
    res.json({ tracks: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load tracks" });
  }
});

router.delete("/:groupId/audio-tracks/:trackId", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const trackId = parseInt(req.params.trackId, 10);
  if (Number.isNaN(trackId)) return res.status(400).json({ error: "invalid track id" });

  try {
    const result = await pool.query("SELECT file_path FROM group_audio_tracks WHERE id = $1 AND group_id = $2", [
      trackId,
      req.groupId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: "track not found" });

    // If this track is currently playing, stop playback for everyone first.
    const playbackResult = await pool.query("SELECT track_id FROM group_playback WHERE group_id = $1", [
      req.groupId,
    ]);
    if (playbackResult.rows[0]?.track_id === trackId) {
      await pool.query(
        `UPDATE group_playback SET track_id = NULL, status = 'stopped', position_ms_base = 0,
         server_started_at = NULL, updated_at = now() WHERE group_id = $1`,
        [req.groupId]
      );
      emitToGroup(req.groupId, "playback:update", await getPlaybackState(req.groupId));
    }

    await pool.query("DELETE FROM group_audio_tracks WHERE id = $1", [trackId]);
    fs.unlink(path.join(__dirname, "..", "uploads", result.rows[0].file_path), () => {});

    res.json({ deleted: trackId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't delete track" });
  }
});

// ---- playback control (admin-only) ----

async function getPlaybackState(groupId) {
  const result = await pool.query(
    `SELECT p.status, p.position_ms_base, p.server_started_at, p.started_by,
            t.id AS track_id, t.title, t.file_path
     FROM group_playback p
     LEFT JOIN group_audio_tracks t ON t.id = p.track_id
     WHERE p.group_id = $1`,
    [groupId]
  );
  const row = result.rows[0];
  return {
    groupId,
    status: row?.status || "stopped",
    positionMsBase: row?.position_ms_base || 0,
    serverStartedAt: row?.server_started_at ? new Date(row.server_started_at).getTime() : null,
    startedBy: row?.started_by || null,
    track: row?.track_id ? { id: row.track_id, title: row.title, filePath: row.file_path } : null,
    serverTime: Date.now(),
  };
}

router.get("/:groupId/playback", requireAuth, requireMembership, async (req, res) => {
  try {
    res.json(await getPlaybackState(req.groupId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load playback state" });
  }
});

router.post("/:groupId/playback/play", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const { trackId, positionMs = 0 } = req.body;
  const parsedTrackId = parseInt(trackId, 10);
  if (Number.isNaN(parsedTrackId)) return res.status(400).json({ error: "trackId is required" });

  try {
    const trackResult = await pool.query("SELECT id FROM group_audio_tracks WHERE id = $1 AND group_id = $2", [
      parsedTrackId,
      req.groupId,
    ]);
    if (trackResult.rows.length === 0) {
      return res.status(404).json({ error: "that track isn't in this group's library" });
    }

    await pool.query(
      `INSERT INTO group_playback (group_id, track_id, status, position_ms_base, server_started_at, started_by, updated_at)
       VALUES ($1, $2, 'playing', $3, now(), $4, now())
       ON CONFLICT (group_id) DO UPDATE SET
         track_id = $2, status = 'playing', position_ms_base = $3, server_started_at = now(),
         started_by = $4, updated_at = now()`,
      [req.groupId, parsedTrackId, Math.max(0, positionMs), req.user.id]
    );

    const state = await getPlaybackState(req.groupId);
    emitToGroup(req.groupId, "playback:update", state);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't start playback" });
  }
});

router.post("/:groupId/playback/pause", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  try {
    const current = await getPlaybackState(req.groupId);
    if (current.status !== "playing") {
      return res.status(400).json({ error: "nothing is currently playing" });
    }

    const elapsed = Date.now() - current.serverStartedAt;
    const frozenPosition = current.positionMsBase + elapsed;

    await pool.query(
      `UPDATE group_playback SET status = 'paused', position_ms_base = $2, server_started_at = NULL, updated_at = now()
       WHERE group_id = $1`,
      [req.groupId, frozenPosition]
    );

    const state = await getPlaybackState(req.groupId);
    emitToGroup(req.groupId, "playback:update", state);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't pause playback" });
  }
});

router.post("/:groupId/playback/seek", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  const { positionMs } = req.body;
  if (typeof positionMs !== "number" || positionMs < 0) {
    return res.status(400).json({ error: "positionMs must be a non-negative number" });
  }

  try {
    const current = await getPlaybackState(req.groupId);
    if (!current.track) {
      return res.status(400).json({ error: "no track is loaded" });
    }

    const resumePlaying = current.status === "playing";
    await pool.query(
      `UPDATE group_playback SET position_ms_base = $2, server_started_at = $3, status = $4, updated_at = now()
       WHERE group_id = $1`,
      [req.groupId, positionMs, resumePlaying ? new Date() : null, resumePlaying ? "playing" : "paused"]
    );

    const state = await getPlaybackState(req.groupId);
    emitToGroup(req.groupId, "playback:update", state);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't seek" });
  }
});

router.post("/:groupId/playback/stop", requireAuth, requireMembership, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE group_playback SET status = 'stopped', track_id = NULL, position_ms_base = 0,
       server_started_at = NULL, updated_at = now() WHERE group_id = $1`,
      [req.groupId]
    );
    // If there was never a row (nobody ever played anything), make sure one exists in a clean stopped state.
    await pool.query(
      `INSERT INTO group_playback (group_id, status) VALUES ($1, 'stopped') ON CONFLICT (group_id) DO NOTHING`,
      [req.groupId]
    );

    const state = await getPlaybackState(req.groupId);
    emitToGroup(req.groupId, "playback:update", state);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't stop playback" });
  }
});

module.exports = router;
