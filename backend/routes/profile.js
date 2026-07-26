const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "posts");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Short clips only — this is a profile feed, not a video hosting service.
// 25MB comfortably covers a short vertical clip or voice memo.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || guessExtension(file.mimetype);
    cb(null, `${uuidv4()}${ext}`);
  },
});

function guessExtension(mimetype) {
  if (mimetype === "video/mp4") return ".mp4";
  if (mimetype === "video/webm") return ".webm";
  if (mimetype === "audio/mpeg") return ".mp3";
  if (mimetype === "audio/wav") return ".wav";
  if (mimetype === "audio/webm") return ".webm";
  return "";
}

function fileFilter(req, file, cb) {
  const isVideo = file.mimetype.startsWith("video/");
  const isAudio = file.mimetype.startsWith("audio/");
  if (!isVideo && !isAudio) {
    return cb(new Error("only video or audio files are allowed"));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

// Upload a new post — field name must be "file", plus optional "caption"
router.post("/posts", requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file is too large — max 25MB" });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "a video or audio file is required (field name: 'file')" });
    }

    const type = req.file.mimetype.startsWith("video/") ? "video" : "audio";
    const relativePath = `posts/${req.file.filename}`;

    try {
      const result = await pool.query(
        `INSERT INTO profile_posts (user_id, type, file_path, caption)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, type, file_path, caption, created_at`,
        [req.user.id, type, relativePath, (req.body.caption || "").trim() || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (dbErr) {
      console.error(dbErr);
      // Clean up the file on disk if the DB insert failed, so we don't leak orphaned uploads.
      fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
      res.status(500).json({ error: "couldn't save the post" });
    }
  });
});

// List a user's posts, with like counts and comment counts
router.get("/:username/posts", requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query("SELECT id, username, avatar FROM users WHERE username = $1", [
      req.params.username,
    ]);
    const profileUser = userResult.rows[0];
    if (!profileUser) {
      return res.status(404).json({ error: `no user named '${req.params.username}'` });
    }

    const postsResult = await pool.query(
      `SELECT
         p.id, p.type, p.file_path, p.caption, p.created_at,
         COUNT(DISTINCT l.user_id)::int AS like_count,
         COUNT(DISTINCT c.id)::int AS comment_count,
         COALESCE(BOOL_OR(l.user_id = $2), false) AS liked_by_me
       FROM profile_posts p
       LEFT JOIN post_likes l ON l.post_id = p.id
       LEFT JOIN post_comments c ON c.post_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [profileUser.id, req.user.id]
    );

    res.json({ profileUser, posts: postsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load that profile" });
  }
});

// Toggle a like on a post
router.post("/posts/:postId/like", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) return res.status(400).json({ error: "invalid post id" });

  try {
    const existing = await pool.query("SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2", [
      postId,
      req.user.id,
    ]);

    if (existing.rows.length > 0) {
      await pool.query("DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2", [postId, req.user.id]);
      return res.json({ liked: false });
    } else {
      await pool.query("INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)", [postId, req.user.id]);
      return res.json({ liked: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update like" });
  }
});

// List comments on a post
router.get("/posts/:postId/comments", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) return res.status(400).json({ error: "invalid post id" });

  try {
    const result = await pool.query(
      `SELECT c.id, c.content, c.created_at, u.username, u.avatar
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );
    res.json({ comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load comments" });
  }
});

// Add a comment
router.post("/posts/:postId/comments", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) return res.status(400).json({ error: "invalid post id" });

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "comment content is required" });
  }

  try {
    const postExists = await pool.query("SELECT 1 FROM profile_posts WHERE id = $1", [postId]);
    if (postExists.rows.length === 0) {
      return res.status(404).json({ error: "post not found" });
    }

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [postId, req.user.id, content.trim()]
    );
    res.status(201).json({ ...result.rows[0], username: req.user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't add comment" });
  }
});

// Delete a post — author only
router.delete("/posts/:postId", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) return res.status(400).json({ error: "invalid post id" });

  try {
    const result = await pool.query("SELECT user_id, file_path FROM profile_posts WHERE id = $1", [postId]);
    const post = result.rows[0];
    if (!post) return res.status(404).json({ error: "post not found" });
    if (post.user_id !== req.user.id) {
      return res.status(403).json({ error: "you can only delete your own posts" });
    }

    await pool.query("DELETE FROM profile_posts WHERE id = $1", [postId]);
    fs.unlink(path.join(__dirname, "..", "uploads", post.file_path), () => {});

    res.json({ deleted: postId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't delete post" });
  }
});

module.exports = router;
