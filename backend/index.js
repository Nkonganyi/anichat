require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const path = require("path");
const authRoutes = require("./routes/auth");
const messageRoutes = require("./routes/messages");
const groupRoutes = require("./routes/groups");
const userRoutes = require("./routes/users");
const gifRoutes = require("./routes/gifs");
const profileRoutes = require("./routes/profile");
const playbackRoutes = require("./routes/playback");
const conversationsRoutes = require("./routes/conversations");
const starredRoutes = require("./routes/starred");
const mutesRoutes = require("./routes/mutes");
const pool = require("./db/pool");
const { setIO, emitToUser } = require("./realtime");
const presence = require("./presence");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "AniChat backend",
    time: new Date().toISOString(),
  });
});

// Used by clients to calibrate clock offset before syncing group audio —
// deliberately unauthenticated and as lightweight as possible, since
// round-trip time directly affects sync accuracy.
app.get("/api/time", (req, res) => {
  res.json({ serverTime: Date.now() });
});

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/users", userRoutes);
app.use("/api/gifs", gifRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/groups", playbackRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/starred-messages", starredRoutes);
app.use("/api/mutes", mutesRoutes);

// Serves uploaded video/audio files directly, e.g. /uploads/posts/abc123.mp4
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Wrap the Express app in a plain HTTP server so Socket.IO can share the same port.
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Every socket connection must present a valid JWT, same as REST requests.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", async (socket) => {
  // Each user gets their own private "room" — this is how we target
  // events at a specific person regardless of which tab/device they're on.
  socket.join(`user:${socket.user.id}`);

  // Also join a room for every group they're currently in, so group
  // messages/events reach them immediately without extra setup.
  try {
    const { rows } = await pool.query("SELECT group_id FROM group_members WHERE user_id = $1", [socket.user.id]);
    rows.forEach((row) => socket.join(`group:${row.group_id}`));
  } catch (err) {
    console.error("failed to join group rooms on connect:", err.message);
  }

  console.log(`socket connected: ${socket.user.username} (${socket.id})`);
  presence.handleSocketConnect(socket.user.id, socket.id, emitToUser).catch((err) =>
    console.error("presence connect handling failed:", err.message)
  );

  // Typing indicators are purely ephemeral — no DB, just a relay through
  // the same room structure used for messages. socket.to() (not io.to())
  // deliberately excludes the sender's own connection.
  socket.on("typing:dm", ({ toUserId, isTyping }) => {
    if (!toUserId) return;
    socket.to(`user:${toUserId}`).emit("typing:dm", {
      fromUserId: socket.user.id,
      fromUsername: socket.user.username,
      isTyping: !!isTyping,
    });
  });

  socket.on("typing:group", ({ groupId, isTyping }) => {
    if (!groupId) return;
    socket.to(`group:${groupId}`).emit("typing:group", {
      groupId,
      fromUserId: socket.user.id,
      fromUsername: socket.user.username,
      isTyping: !!isTyping,
    });
  });

  socket.on("disconnect", () => {
    console.log(`socket disconnected: ${socket.user.username}`);
    presence.handleSocketDisconnect(socket.user.id, socket.id, emitToUser).catch((err) =>
      console.error("presence disconnect handling failed:", err.message)
    );
  });
});

setIO(io);

server.listen(PORT, () => {
  console.log(`AniChat backend running on http://localhost:${PORT}`);
});
