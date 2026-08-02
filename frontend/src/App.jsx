import { useEffect, useRef, useState } from "react";
import "./App.css";
import {
  register,
  login,
  getConversation,
  sendMessage,
  createGroup,
  listGroups,
  getGroup,
  sendGroupMessage,
  addGroupMember,
  removeGroupMember,
  updateAvatar,
  updateTheme,
  uploadPost,
  getUserPosts,
  toggleLike,
  getComments,
  addComment,
  deletePost,
  markDmRead,
  markGroupRead,
  editMessage,
  deleteMessage,
  editGroupMessage,
  deleteGroupMessage,
  reactToMessage,
  reactToGroupMessage,
  changeGroupMemberRole,
  forwardMessage,
  forwardGroupMessage,
  pinMessage,
  unpinMessage,
  pinGroupMessage,
  unpinGroupMessage,
  starMessage,
  starGroupMessage,
  getStarredMessages,
  sendVoiceMessage,
  sendGroupVoiceMessage,
  sendVideoNote,
  sendGroupVideoNote,
  sendFileMessage,
  sendGroupFileMessage,
  muteDm,
  unmuteDm,
  muteGroup,
  unmuteGroup,
  BACKEND_URL,
} from "./api";
import { compressImageIfNeeded } from "./imageCompression";
import { useVoiceRecorder } from "./voiceRecorder";
import { useVideoNoteRecorder } from "./videoRecorder";
import { ListenTogether } from "./listenTogether";
import { InboxPanel } from "./inbox";
import { getVoice, renderSystemMessage } from "./voices";
import { connectSocket } from "./socket";
import { getAvatar } from "./constants";
import { getTheme, applyTheme } from "./themes";
import {
  AvatarBadge,
  AvatarPicker,
  StickerPicker,
  EmojiPicker,
  GifPicker,
  ThemePicker,
  AmbientMotif,
  MessageContent,
  MessageActions,
  EditMessageForm,
  ReactionBar,
  ReactionPicker,
  ForwardPicker,
  PinnedBar,
  PresenceLabel,
  MuteButton,
} from "./pickers";

// Loaded once, covers every theme's font choices.
function useThemeFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Cinzel:wght@600;700&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const action = mode === "login" ? login : register;
      const data = await action(username.trim(), password);
      onAuthed(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>AniChat 🌸</h1>
      <p className="subtitle">Milestone 15 — Video Notes</p>

      <div className="tab-row">
        <button className={mode === "login" ? "tab active" : "tab"} onClick={() => setMode("login")}>
          Log in
        </button>
        <button className={mode === "register" ? "tab active" : "tab"} onClick={() => setMode("register")}>
          Register
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <input
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

function DMPanel({ token, myUserId, socket, openTarget, myTheme, presence }) {
  const [otherUser, setOtherUser] = useState("");
  const [activeChat, setActiveChat] = useState(null); // { id, username, avatar }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [openPicker, setOpenPicker] = useState(null); // "sticker" | "emoji" | "gif" | null
  const [otherUserReadUpTo, setOtherUserReadUpTo] = useState(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [forwardPickerFor, setForwardPickerFor] = useState(null);
  const [myGroups, setMyGroups] = useState([]);
  const [failedMessages, setFailedMessages] = useState([]); // [{tempId, content, type, error}]
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef(null);
  const activeChatRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const otherTypingTimeoutRef = useRef(null);
  const voiceRecorder = useVoiceRecorder();
  const videoRecorder = useVideoNoteRecorder();
  const videoPreviewRef = useRef(null);
  const fileInputRef = useRef(null);
  const [fileError, setFileError] = useState("");

  async function loadConversation(withUsername) {
    try {
      const data = await getConversation(token, withUsername);
      setMessages(data.messages);
      setActiveChat(data.otherUser);
      activeChatRef.current = data.otherUser;
      setOtherUserReadUpTo(data.otherUserReadUpTo);
      setOtherTyping(false);
      setSearchQuery("");
      setSearchOpen(false);
      setError("");
      markDmRead(token, withUsername).catch(() => {});
      setDraft(localStorage.getItem(`anichat_draft_dm_${withUsername}`) || "");
    } catch (err) {
      setError(err.message);
    }
  }

  function openChat(e) {
    e.preventDefault();
    const name = otherUser.trim();
    if (!name) return;
    loadConversation(name);
  }

  useEffect(() => {
    if (!activeChat) return;
    if (draft) {
      localStorage.setItem(`anichat_draft_dm_${activeChat.username}`, draft);
    } else {
      localStorage.removeItem(`anichat_draft_dm_${activeChat.username}`);
    }
  }, [draft, activeChat]);

  useEffect(() => {
    listGroups(token)
      .then((data) => setMyGroups(data.groups))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (openTarget?.type === "dm" && openTarget.username) {
      loadConversation(openTarget.username);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);

  useEffect(() => {
    if (!socket) return;
    function handleNewMessage(msg) {
      const chat = activeChatRef.current;
      if (!chat) return;
      const belongsToOpenChat =
        (msg.sender_id === myUserId && msg.receiver_id === chat.id) ||
        (msg.sender_id === chat.id && msg.receiver_id === myUserId);
      if (!belongsToOpenChat) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.sender_id === chat.id) {
        markDmRead(token, chat.username).catch(() => {});
      }
    }
    function handleDelivered(evt) {
      setMessages((prev) => prev.map((m) => (m.id === evt.messageId ? { ...m, delivered_at: evt.deliveredAt } : m)));
    }
    function handleRead(evt) {
      const chat = activeChatRef.current;
      if (!chat || evt.byUserId !== chat.id) return;
      setOtherUserReadUpTo(evt.readUpTo);
    }
    function handleTyping(evt) {
      const chat = activeChatRef.current;
      if (!chat || evt.fromUserId !== chat.id) return;
      setOtherTyping(evt.isTyping);
      clearTimeout(otherTypingTimeoutRef.current);
      if (evt.isTyping) {
        // Safety auto-clear in case a "stopped typing" event gets dropped —
        // comfortably longer than the ~2s heartbeat interval so a single
        // missed beat doesn't cause a visible flicker.
        otherTypingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 6000);
      }
    }
    function handleEdited(evt) {
      setMessages((prev) =>
        prev.map((m) => (m.id === evt.messageId ? { ...m, content: evt.content, edited_at: evt.editedAt } : m))
      );
    }
    function handleDeleted(evt) {
      setMessages((prev) =>
        prev.map((m) => (m.id === evt.messageId ? { ...m, content: null, deleted_at: evt.deletedAt } : m))
      );
    }
    function handleReaction(evt) {
      setMessages((prev) => prev.map((m) => (m.id === evt.messageId ? { ...m, reactions: evt.reactions } : m)));
    }
    function handlePinned(evt) {
      setMessages((prev) => prev.map((m) => (m.id === evt.messageId ? { ...m, pinned_at: evt.pinnedAt } : m)));
    }
    function handleUnpinned(evt) {
      setMessages((prev) => prev.map((m) => (m.id === evt.messageId ? { ...m, pinned_at: null } : m)));
    }
    socket.on("message:new", handleNewMessage);
    socket.on("message:delivered", handleDelivered);
    socket.on("dm:read", handleRead);
    socket.on("typing:dm", handleTyping);
    socket.on("message:edited", handleEdited);
    socket.on("message:deleted", handleDeleted);
    socket.on("message:reaction", handleReaction);
    socket.on("message:pinned", handlePinned);
    socket.on("message:unpinned", handleUnpinned);
    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("message:delivered", handleDelivered);
      socket.off("dm:read", handleRead);
      socket.off("typing:dm", handleTyping);
      socket.off("message:edited", handleEdited);
      socket.off("message:deleted", handleDeleted);
      socket.off("message:reaction", handleReaction);
      socket.off("message:pinned", handlePinned);
      socket.off("message:unpinned", handleUnpinned);
    };
  }, [socket, myUserId, token]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function stopTypingSignal() {
    if (!socket || !activeChat) return;
    clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket.emit("typing:dm", { toUserId: activeChat.id, isTyping: false });
    }
  }

  function handleDraftChange(e) {
    const value = e.target.value;
    setDraft(value);
    if (!socket || !activeChat) return;

    // Re-send the "typing" signal periodically (not just once) so the
    // receiver's own safety-timeout keeps getting refreshed during a long
    // typing session — otherwise a slow typist mid-message could have their
    // indicator vanish on the recipient's screen even while still typing.
    const now = Date.now();
    if (!isTypingRef.current || now - lastTypingEmitRef.current > 2000) {
      isTypingRef.current = true;
      lastTypingEmitRef.current = now;
      socket.emit("typing:dm", { toUserId: activeChat.id, isTyping: true });
    }
    clearTimeout(typingTimeoutRef.current);
    // 3s of no keystrokes (not 2s) — forgiving enough for someone pausing
    // to find a key or think, without feeling like it never turns off.
    typingTimeoutRef.current = setTimeout(stopTypingSignal, 3000);
  }

  async function send(content, type = "text") {
    if (!content.trim() || !activeChat) return;
    stopTypingSignal();
    const chatUsername = activeChat.username;
    const replyToId = replyTarget?.id || null;
    try {
      await sendMessage(token, chatUsername, content, type, replyToId);
      if (type === "text") {
        setDraft("");
        localStorage.removeItem(`anichat_draft_dm_${chatUsername}`);
      }
      setOpenPicker(null);
      setReplyTarget(null);
    } catch (err) {
      // Keep the failed attempt visible with a retry option instead of
      // silently dropping it — a network blip shouldn't cost you your message.
      setFailedMessages((prev) => [
        ...prev,
        { tempId: `failed-${Date.now()}-${Math.random()}`, content, type, replyToId, error: err.message },
      ]);
      if (type === "text") setDraft("");
      setOpenPicker(null);
      setReplyTarget(null);
    }
  }

  async function handleRetryFailed(tempId) {
    const failed = failedMessages.find((f) => f.tempId === tempId);
    if (!failed || !activeChat) return;
    setFailedMessages((prev) => prev.filter((f) => f.tempId !== tempId));
    try {
      await sendMessage(token, activeChat.username, failed.content, failed.type, failed.replyToId);
    } catch (err) {
      setFailedMessages((prev) => [...prev, { ...failed, error: err.message }]);
    }
  }

  function handleDiscardFailed(tempId) {
    setFailedMessages((prev) => prev.filter((f) => f.tempId !== tempId));
  }

  async function handleSendVoice() {
    const result = await voiceRecorder.stopRecording();
    if (!result || !activeChat) return;
    try {
      await sendVoiceMessage(token, activeChat.username, result.blob, result.duration, replyTarget?.id || null);
      setReplyTarget(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = videoRecorder.stream;
    }
  }, [videoRecorder.stream]);

  async function handleSendVideoNote() {
    const result = await videoRecorder.stopRecording();
    if (!result || !activeChat) return;
    console.log("[video-note] recorded blob type:", result.blob.type, "size:", result.blob.size, "duration:", result.duration);
    try {
      await sendVideoNote(token, activeChat.username, result.blob, result.duration, replyTarget?.id || null);
      setReplyTarget(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function handlePickFile() {
    setFileError("");
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file || !activeChat) return;
    setFileError("");
    try {
      // Images get compressed client-side before the upload even starts
      // (the server compresses too, but shrinking it here means less data
      // over the wire and a faster send). Video is uploaded as-is — see
      // imageCompression.js for why video compression stays server-side.
      const { blob, fileName } = await compressImageIfNeeded(file);
      await sendFileMessage(token, activeChat.username, blob, replyTarget?.id || null, fileName);
      setReplyTarget(null);
    } catch (err) {
      setFileError(err.message);
    }
  }

  async function handleMuteChat(durationHours) {
    if (!activeChat) return;
    try {
      const result = await muteDm(token, activeChat.username, durationHours);
      setActiveChat((prev) => ({ ...prev, muted: true, muted_until: result.mutedUntil }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUnmuteChat() {
    if (!activeChat) return;
    try {
      await unmuteDm(token, activeChat.username);
      setActiveChat((prev) => ({ ...prev, muted: false, muted_until: null }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReact(messageId, emoji) {
    setReactionPickerFor(null);
    try {
      await reactToMessage(token, messageId, emoji);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleForward(messageId, target) {
    setForwardPickerFor(null);
    try {
      await forwardMessage(token, messageId, target);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePinToggle(m) {
    try {
      if (m.pinned_at) await unpinMessage(token, m.id);
      else await pinMessage(token, m.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStarToggle(m) {
    try {
      const result = await starMessage(token, m.id);
      setMessages((prev) => prev.map((msg) => (msg.id === m.id ? { ...msg, starred_by_me: result.starred } : msg)));
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSend(e) {
    e.preventDefault();
    send(draft, "text");
  }

  function tickState(message) {
    const isRead = otherUserReadUpTo && new Date(message.created_at) <= new Date(otherUserReadUpTo);
    if (isRead) return "read";
    if (message.delivered_at) return "delivered";
    return "sent";
  }

  async function handleEditSave(messageId, content) {
    try {
      await editMessage(token, messageId, content);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(messageId, mode) {
    try {
      await deleteMessage(token, messageId, mode);
      if (mode === "me") {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
      // mode === "everyone" updates arrive via the message:deleted socket event
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <form className="open-chat-row" onSubmit={openChat}>
        <input
          placeholder="chat with username…"
          value={otherUser}
          onChange={(e) => setOtherUser(e.target.value)}
        />
        <button className="primary-btn small" type="submit">
          Open
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {activeChat && (() => {
        // Live socket updates (if any have arrived since opening this chat)
        // take priority; otherwise fall back to the snapshot the
        // conversation-load REST call returned.
        const livePresence = presence[activeChat.id];
        const online = livePresence ? livePresence.online : activeChat.online;
        const lastSeenAt = livePresence ? livePresence.lastSeenAt : activeChat.last_seen_at;
        return (
        <>
          <div className="conversation-title with-avatar">
            <AvatarBadge avatar={getAvatar(activeChat.avatar)} size={22} />
            <div className="conversation-title-text">
              <span>Conversation with {activeChat.username}</span>
              <PresenceLabel online={online} lastSeenAt={lastSeenAt} />
            </div>
            <button className="search-toggle-btn" onClick={() => setSearchOpen((v) => !v)} title="Search in conversation">
              🔍
            </button>
            <MuteButton
              muted={!!activeChat.muted}
              mutedUntil={activeChat.muted_until}
              onMute={handleMuteChat}
              onUnmute={handleUnmuteChat}
            />
          </div>

          {searchOpen && (
            <input
              className="in-chat-search"
              placeholder="Search this conversation…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          )}

          <PinnedBar
            pinnedMessages={messages.filter((m) => m.pinned_at)}
            onUnpin={(id) => unpinMessage(token, id).catch((err) => setError(err.message))}
            canUnpin
          />

          <div ref={scrollRef} className="message-list">
            {messages.length === 0 && <p className="muted center">{getVoice(myTheme).emptyDm}</p>}
            {(searchQuery
              ? messages.filter((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
              : messages
            ).map((m) => {
              const mine = m.sender_id === myUserId;
              return (
                <div key={m.id} className={`bubble-row ${mine ? "mine" : ""}`}>
                  <div className="message-wrapper">
                    {editingId === m.id ? (
                      <EditMessageForm
                        initial={m.content}
                        onSave={(content) => handleEditSave(m.id, content)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div>
                        <MessageContent message={m} mine={mine} />
                        {mine && !m.deleted_at && (
                          <span className={`msg-ticks ${tickState(m)}`}>{tickState(m) === "sent" ? "✓" : "✓✓"}</span>
                        )}
                        <ReactionBar reactions={m.reactions} myUserId={myUserId} onToggle={(emoji) => handleReact(m.id, emoji)} />
                        {reactionPickerFor === m.id && (
                          <ReactionPicker onPick={(emoji) => handleReact(m.id, emoji)} onClose={() => setReactionPickerFor(null)} />
                        )}
                        {forwardPickerFor === m.id && (
                          <ForwardPicker
                            groups={myGroups}
                            onForwardToUser={(username) => handleForward(m.id, { toUsername: username })}
                            onForwardToGroup={(groupId) => handleForward(m.id, { toGroupId: groupId })}
                            onClose={() => setForwardPickerFor(null)}
                          />
                        )}
                      </div>
                    )}
                    {!m.deleted_at && editingId !== m.id && (
                      <MessageActions
                        canEdit={mine && m.type === "text"}
                        canDeleteEveryone={mine}
                        canPin
                        isPinned={!!m.pinned_at}
                        isStarred={!!m.starred_by_me}
                        onReply={() => setReplyTarget(m)}
                        onReact={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                        onForward={() => setForwardPickerFor(forwardPickerFor === m.id ? null : m.id)}
                        onPin={() => handlePinToggle(m)}
                        onStar={() => handleStarToggle(m)}
                        onEdit={() => setEditingId(m.id)}
                        onDeleteMe={() => handleDelete(m.id, "me")}
                        onDeleteEveryone={() => handleDelete(m.id, "everyone")}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Deliberately outside the scrollable list — always visible regardless
              of scroll position, instead of silently scrolling off-screen. */}
          {otherTyping && (
            <div className="typing-indicator-bar">
              <span className="typing-dots"><span></span><span></span><span></span></span>
              {activeChat.username} is typing…
            </div>
          )}

          {failedMessages.map((f) => (
            <div key={f.tempId} className="failed-message-bar">
              <span className="failed-message-text">⚠️ Failed to send: "{f.content.slice(0, 40)}"</span>
              <button className="link-btn" onClick={() => handleRetryFailed(f.tempId)}>Retry</button>
              <button className="failed-message-discard" onClick={() => handleDiscardFailed(f.tempId)}>✕</button>
            </div>
          ))}

          {replyTarget && (
            <div className="reply-strip">
              <span className="reply-strip-text">
                Replying to <strong>{replyTarget.sender_id === myUserId ? "yourself" : activeChat.username}</strong>:{" "}
                {replyTarget.content?.slice(0, 50) || "[media]"}
              </span>
              <button className="reply-strip-cancel" onClick={() => setReplyTarget(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="composer-toolbar">
            <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "sticker" ? null : "sticker")}>
              🌟
            </button>
            <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "emoji" ? null : "emoji")}>
              😊
            </button>
            <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "gif" ? null : "gif")}>
              GIF
            </button>
            <button
              type="button"
              className={`toolbar-btn ${voiceRecorder.isRecording ? "recording" : ""}`}
              onClick={voiceRecorder.isRecording ? undefined : voiceRecorder.startRecording}
              disabled={voiceRecorder.isRecording || videoRecorder.isRecording}
            >
              🎤
            </button>
            <button
              type="button"
              className={`toolbar-btn ${videoRecorder.isRecording ? "recording" : ""}`}
              onClick={videoRecorder.isRecording ? undefined : videoRecorder.startRecording}
              disabled={videoRecorder.isRecording || voiceRecorder.isRecording}
            >
              📹
            </button>
            <button type="button" className="toolbar-btn" onClick={handlePickFile}>
              📎
            </button>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileSelected} />
          </div>

          {voiceRecorder.error && <p className="error-text small-text">{voiceRecorder.error}</p>}
          {videoRecorder.error && <p className="error-text small-text">{videoRecorder.error}</p>}
          {fileError && <p className="error-text small-text">{fileError}</p>}

          {openPicker === "sticker" && <StickerPicker onPick={(id) => send(id, "sticker")} onClose={() => setOpenPicker(null)} />}
          {openPicker === "emoji" && (
            <EmojiPicker onPick={(e) => setDraft((d) => d + e)} onClose={() => setOpenPicker(null)} />
          )}
          {openPicker === "gif" && (
            <GifPicker token={token} onPick={(url) => send(url, "gif")} onClose={() => setOpenPicker(null)} />
          )}

          {videoRecorder.isRecording ? (
            <div className="video-recording-bar">
              <video ref={videoPreviewRef} autoPlay muted playsInline className="video-recording-preview" />
              <div className="video-recording-controls">
                <span className="recording-dot" />
                <span className="recording-timer">
                  {Math.floor(videoRecorder.elapsedSeconds / 60)}:{(videoRecorder.elapsedSeconds % 60).toString().padStart(2, "0")}
                </span>
                <button type="button" className="link-btn" onClick={videoRecorder.cancelRecording}>
                  Cancel
                </button>
                <button type="button" className="primary-btn small" onClick={handleSendVideoNote}>
                  Send
                </button>
              </div>
            </div>
          ) : voiceRecorder.isRecording ? (
            <div className="recording-bar">
              <span className="recording-dot" />
              <span className="recording-timer">
                {Math.floor(voiceRecorder.elapsedSeconds / 60)}:{(voiceRecorder.elapsedSeconds % 60).toString().padStart(2, "0")}
              </span>
              <span className="recording-hint">Recording…</span>
              <button type="button" className="link-btn" onClick={voiceRecorder.cancelRecording}>
                Cancel
              </button>
              <button type="button" className="primary-btn small" onClick={handleSendVoice}>
                Send
              </button>
            </div>
          ) : (
            <form className="send-row" onSubmit={handleSend}>
              <input
                placeholder={`Message ${activeChat.username}…`}
                value={draft}
                onChange={handleDraftChange}
              />
              <button className="primary-btn small" type="submit">
                Send
              </button>
            </form>
          )}
        </>
        );
      })()}
    </>
  );
}

function GroupsPanel({ token, myUserId, socket, myTheme, openTarget }) {
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [activeGroup, setActiveGroup] = useState(null); // { group, myRole, members, messages }
  const [addUsername, setAddUsername] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [kickingId, setKickingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [forwardPickerFor, setForwardPickerFor] = useState(null);
  const [failedMessages, setFailedMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState(null); // "sticker" | "emoji" | "gif" | null
  const [typingUsers, setTypingUsers] = useState([]); // usernames currently typing in the open group
  const scrollRef = useRef(null);
  const activeGroupIdRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const typingClearTimersRef = useRef({});
  const voiceRecorder = useVoiceRecorder();
  const videoRecorder = useVideoNoteRecorder();
  const videoPreviewRef = useRef(null);
  const fileInputRef = useRef(null);
  const [fileError, setFileError] = useState("");

  async function refreshGroupList() {
    try {
      const data = await listGroups(token);
      setGroups(data.groups);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refreshGroupList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openGroup(groupId) {
    try {
      const data = await getGroup(token, groupId);
      setActiveGroup(data);
      activeGroupIdRef.current = data.group.id;
      setTypingUsers([]);
      setSearchQuery("");
      setSearchOpen(false);
      setError("");
      markGroupRead(token, groupId).catch(() => {});
      setDraft(localStorage.getItem(`anichat_draft_group_${groupId}`) || "");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!activeGroup) return;
    const groupId = activeGroup.group.id;
    if (draft) {
      localStorage.setItem(`anichat_draft_group_${groupId}`, draft);
    } else {
      localStorage.removeItem(`anichat_draft_group_${groupId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    if (openTarget?.type === "group" && openTarget.groupId) {
      openGroup(openTarget.groupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);

  async function handleCreateGroup(e) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const group = await createGroup(token, name);
      setNewGroupName("");
      await refreshGroupList();
      openGroup(group.id);
    } catch (err) {
      setError(err.message);
    }
  }

  function stopTypingSignal() {
    if (!socket || !activeGroup) return;
    clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket.emit("typing:group", { groupId: activeGroup.group.id, isTyping: false });
    }
  }

  function handleDraftChange(e) {
    const value = e.target.value;
    setDraft(value);
    if (!socket || !activeGroup) return;
    const now = Date.now();
    if (!isTypingRef.current || now - lastTypingEmitRef.current > 2000) {
      isTypingRef.current = true;
      lastTypingEmitRef.current = now;
      socket.emit("typing:group", { groupId: activeGroup.group.id, isTyping: true });
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTypingSignal, 3000);
  }

  async function send(content, type = "text") {
    if (!content.trim() || !activeGroup) return;
    stopTypingSignal();
    const groupId = activeGroup.group.id;
    const replyToId = replyTarget?.id || null;
    try {
      await sendGroupMessage(token, groupId, content, type, replyToId);
      if (type === "text") {
        setDraft("");
        localStorage.removeItem(`anichat_draft_group_${groupId}`);
      }
      setOpenPicker(null);
      setReplyTarget(null);
    } catch (err) {
      setFailedMessages((prev) => [
        ...prev,
        { tempId: `failed-${Date.now()}-${Math.random()}`, content, type, replyToId, error: err.message },
      ]);
      if (type === "text") setDraft("");
      setOpenPicker(null);
      setReplyTarget(null);
    }
  }

  async function handleRetryFailed(tempId) {
    const failed = failedMessages.find((f) => f.tempId === tempId);
    if (!failed || !activeGroup) return;
    setFailedMessages((prev) => prev.filter((f) => f.tempId !== tempId));
    try {
      await sendGroupMessage(token, activeGroup.group.id, failed.content, failed.type, failed.replyToId);
    } catch (err) {
      setFailedMessages((prev) => [...prev, { ...failed, error: err.message }]);
    }
  }

  function handleDiscardFailed(tempId) {
    setFailedMessages((prev) => prev.filter((f) => f.tempId !== tempId));
  }

  async function handleSendVoice() {
    const result = await voiceRecorder.stopRecording();
    if (!result || !activeGroup) return;
    try {
      await sendGroupVoiceMessage(token, activeGroup.group.id, result.blob, result.duration, replyTarget?.id || null);
      setReplyTarget(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = videoRecorder.stream;
    }
  }, [videoRecorder.stream]);

  async function handleSendVideoNote() {
    const result = await videoRecorder.stopRecording();
    if (!result || !activeGroup) return;
    console.log("[video-note] recorded blob type:", result.blob.type, "size:", result.blob.size, "duration:", result.duration);
    try {
      await sendGroupVideoNote(token, activeGroup.group.id, result.blob, result.duration, replyTarget?.id || null);
      setReplyTarget(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function handlePickFile() {
    setFileError("");
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeGroup) return;
    setFileError("");
    try {
      const { blob, fileName } = await compressImageIfNeeded(file);
      await sendGroupFileMessage(token, activeGroup.group.id, blob, replyTarget?.id || null, fileName);
      setReplyTarget(null);
    } catch (err) {
      setFileError(err.message);
    }
  }

  async function handleMuteGroup(durationHours) {
    if (!activeGroup) return;
    try {
      const result = await muteGroup(token, activeGroup.group.id, durationHours);
      setActiveGroup((prev) => ({ ...prev, muted: true, mutedUntil: result.mutedUntil }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUnmuteGroup() {
    if (!activeGroup) return;
    try {
      await unmuteGroup(token, activeGroup.group.id);
      setActiveGroup((prev) => ({ ...prev, muted: false, mutedUntil: null }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReact(messageId, emoji) {
    setReactionPickerFor(null);
    try {
      await reactToGroupMessage(token, activeGroup.group.id, messageId, emoji);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleForward(messageId, target) {
    setForwardPickerFor(null);
    try {
      await forwardGroupMessage(token, activeGroup.group.id, messageId, target);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePinToggle(m) {
    try {
      if (m.pinned_at) await unpinGroupMessage(token, activeGroup.group.id, m.id);
      else await pinGroupMessage(token, activeGroup.group.id, m.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStarToggle(m) {
    try {
      const result = await starGroupMessage(token, activeGroup.group.id, m.id);
      setActiveGroup((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) => (msg.id === m.id ? { ...msg, starred_by_me: result.starred } : msg)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRoleChange(username, role) {
    try {
      await changeGroupMemberRole(token, activeGroup.group.id, username, role);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSend(e) {
    e.preventDefault();
    send(draft, "text");
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const username = addUsername.trim();
    if (!username || !activeGroup) return;
    try {
      await addGroupMember(token, activeGroup.group.id, username);
      setAddUsername("");
      openGroup(activeGroup.group.id); // refresh member list + system message
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleKick(username) {
    if (!activeGroup) return;
    setKickingId(username);
    try {
      await removeGroupMember(token, activeGroup.group.id, username);
      setTimeout(() => {
        openGroup(activeGroup.group.id);
        setKickingId(null);
      }, 550); // let the poof animation play before refreshing the list
    } catch (err) {
      setError(err.message);
      setKickingId(null);
    }
  }

  useEffect(() => {
    if (!socket) return;

    function handleGroupMessage(msg) {
      if (msg.group_id !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev || prev.messages.some((m) => m.id === msg.id)) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
      if (msg.sender_id !== myUserId) {
        markGroupRead(token, msg.group_id).catch(() => {});
      }
    }

    function handleGroupEvent(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        const messages = prev.messages.some((m) => m.id === evt.message.id)
          ? prev.messages
          : [...prev.messages, evt.message];

        let members = prev.members;
        if (evt.type === "member_kicked") {
          members = members.filter((m) => m.username !== evt.targetUsername);
        }
        return { ...prev, messages, members };
      });
      // A member add changes the roster in a way easiest to just refetch cleanly.
      if (evt.type === "member_added" && evt.groupId === activeGroupIdRef.current) {
        openGroup(evt.groupId);
      }
    }

    function handleGroupTyping(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      clearTimeout(typingClearTimersRef.current[evt.fromUsername]);
      if (evt.isTyping) {
        setTypingUsers((prev) => (prev.includes(evt.fromUsername) ? prev : [...prev, evt.fromUsername]));
        typingClearTimersRef.current[evt.fromUsername] = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== evt.fromUsername));
        }, 6000);
      } else {
        setTypingUsers((prev) => prev.filter((u) => u !== evt.fromUsername));
      }
    }

    function handleGroupEdited(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === evt.messageId ? { ...m, content: evt.content, edited_at: evt.editedAt } : m
          ),
        };
      });
    }

    function handleGroupDeleted(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === evt.messageId ? { ...m, content: null, deleted_at: evt.deletedAt } : m
          ),
        };
      });
    }

    function handleGroupReaction(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === evt.messageId ? { ...m, reactions: evt.reactions } : m)),
        };
      });
    }

    function handleRoleChanged(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          members: prev.members.map((m) => (m.username === evt.username ? { ...m, role: evt.role } : m)),
        };
      });
    }

    function handleGroupPinned(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === evt.messageId ? { ...m, pinned_at: evt.pinnedAt } : m)),
        };
      });
    }

    function handleGroupUnpinned(evt) {
      if (evt.groupId !== activeGroupIdRef.current) return;
      setActiveGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === evt.messageId ? { ...m, pinned_at: null } : m)),
        };
      });
    }

    socket.on("group_message:new", handleGroupMessage);
    socket.on("group:event", handleGroupEvent);
    socket.on("typing:group", handleGroupTyping);
    socket.on("group_message:edited", handleGroupEdited);
    socket.on("group_message:deleted", handleGroupDeleted);
    socket.on("group_message:reaction", handleGroupReaction);
    socket.on("group:role_changed", handleRoleChanged);
    socket.on("group_message:pinned", handleGroupPinned);
    socket.on("group_message:unpinned", handleGroupUnpinned);
    return () => {
      socket.off("group_message:new", handleGroupMessage);
      socket.off("group:event", handleGroupEvent);
      socket.off("typing:group", handleGroupTyping);
      socket.off("group_message:edited", handleGroupEdited);
      socket.off("group_message:deleted", handleGroupDeleted);
      socket.off("group_message:reaction", handleGroupReaction);
      socket.off("group:role_changed", handleRoleChanged);
      socket.off("group_message:pinned", handleGroupPinned);
      socket.off("group_message:unpinned", handleGroupUnpinned);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, token, myUserId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeGroup?.messages]);

  const isAdmin = activeGroup && (activeGroup.myRole === "owner" || activeGroup.myRole === "admin");

  async function handleEditSave(messageId, content) {
    try {
      await editGroupMessage(token, activeGroup.group.id, messageId, content);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(messageId, mode) {
    try {
      await deleteGroupMessage(token, activeGroup.group.id, messageId, mode);
      if (mode === "me") {
        setActiveGroup((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== messageId) }));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="groups-layout">
      <div className="group-sidebar">
        <form onSubmit={handleCreateGroup} className="create-group-row">
          <input
            placeholder="new group name…"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <button className="primary-btn small" type="submit">
            +
          </button>
        </form>
        <div className="group-list">
          {groups.map((g) => (
            <button
              key={g.id}
              className={`group-list-item ${activeGroup?.group.id === g.id ? "active" : ""}`}
              onClick={() => openGroup(g.id)}
            >
              <span>{g.name}</span>
              {g.role !== "member" && <span className="role-badge">{g.role}</span>}
            </button>
          ))}
          {groups.length === 0 && <p className="muted center small-text">{getVoice(myTheme).emptyGroups}</p>}
        </div>
      </div>

      <div className="group-main">
        {error && <p className="error-text">{error}</p>}

        {activeGroup ? (
          <>
            <div className="conversation-title">
              {activeGroup.group.name} · {activeGroup.members.length} members
              <button className="search-toggle-btn" onClick={() => setSearchOpen((v) => !v)} title="Search in this group">
                🔍
              </button>
              <MuteButton
                muted={!!activeGroup.muted}
                mutedUntil={activeGroup.mutedUntil}
                onMute={handleMuteGroup}
                onUnmute={handleUnmuteGroup}
              />
            </div>

            {searchOpen && (
              <input
                className="in-chat-search"
                placeholder="Search this group…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            )}

            <div className="member-chip-row">
              {activeGroup.members.map((m) => (
                <div
                  key={m.id}
                  className="member-chip"
                  style={{ animation: kickingId === m.username ? "poof .55s ease forwards" : "none" }}
                >
                  <AvatarBadge avatar={getAvatar(m.avatar)} size={20} />
                  <span>{m.username}</span>
                  {m.role !== "member" && <span className="role-badge tiny">{m.role}</span>}
                  {activeGroup.myRole === "owner" && m.role !== "owner" && m.id !== myUserId && (
                    <button
                      className="kick-btn"
                      title={m.role === "admin" ? `Demote ${m.username} to member` : `Promote ${m.username} to admin`}
                      onClick={() => handleRoleChange(m.username, m.role === "admin" ? "member" : "admin")}
                    >
                      {m.role === "admin" ? "⬇️" : "⬆️"}
                    </button>
                  )}
                  {isAdmin && m.role !== "owner" && m.id !== myUserId && (
                    <button className="kick-btn" title={`Kick ${m.username}`} onClick={() => handleKick(m.username)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isAdmin && (
              <form className="open-chat-row" onSubmit={handleAddMember}>
                <input
                  placeholder="add member by username…"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                />
                <button className="primary-btn small" type="submit">
                  Add
                </button>
              </form>
            )}

            <ListenTogether token={token} groupId={activeGroup.group.id} socket={socket} isAdmin={isAdmin} myTheme={myTheme} />

            <PinnedBar
              pinnedMessages={activeGroup.messages.filter((m) => m.pinned_at)}
              onUnpin={(id) => unpinGroupMessage(token, activeGroup.group.id, id).catch((err) => setError(err.message))}
              canUnpin={isAdmin}
            />

            <div ref={scrollRef} className="message-list">
              {(searchQuery
                ? activeGroup.messages.filter((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
                : activeGroup.messages
              ).map((m) =>
                m.type === "system" ? (
                  <div key={m.id} className="system-msg-row">
                    <span className="system-msg">💨 {renderSystemMessage(m, myTheme)}</span>
                  </div>
                ) : (
                  <div key={m.id} className={`bubble-row ${m.sender_id === myUserId ? "mine" : ""}`}>
                    <div className="message-wrapper">
                      {editingId === m.id ? (
                        <EditMessageForm
                          initial={m.content}
                          onSave={(content) => handleEditSave(m.id, content)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <div>
                          {m.sender_id !== myUserId && <div className="sender-label">{m.sender_username}</div>}
                          <MessageContent message={m} mine={m.sender_id === myUserId} />
                          <ReactionBar reactions={m.reactions} myUserId={myUserId} onToggle={(emoji) => handleReact(m.id, emoji)} />
                          {reactionPickerFor === m.id && (
                            <ReactionPicker onPick={(emoji) => handleReact(m.id, emoji)} onClose={() => setReactionPickerFor(null)} />
                          )}
                          {forwardPickerFor === m.id && (
                            <ForwardPicker
                              groups={groups}
                              onForwardToUser={(username) => handleForward(m.id, { toUsername: username })}
                              onForwardToGroup={(groupId) => handleForward(m.id, { toGroupId: groupId })}
                              onClose={() => setForwardPickerFor(null)}
                            />
                          )}
                        </div>
                      )}
                      {!m.deleted_at && editingId !== m.id && (
                        <MessageActions
                          canEdit={m.sender_id === myUserId && m.type === "text"}
                          canDeleteEveryone={m.sender_id === myUserId || isAdmin}
                          canPin={isAdmin}
                          isPinned={!!m.pinned_at}
                          isStarred={!!m.starred_by_me}
                          onReply={() => setReplyTarget(m)}
                          onReact={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                          onForward={() => setForwardPickerFor(forwardPickerFor === m.id ? null : m.id)}
                          onPin={() => handlePinToggle(m)}
                          onStar={() => handleStarToggle(m)}
                          onEdit={() => setEditingId(m.id)}
                          onDeleteMe={() => handleDelete(m.id, "me")}
                          onDeleteEveryone={() => handleDelete(m.id, "everyone")}
                        />
                      )}
                    </div>
                  </div>
                )
              )}
            </div>

            {failedMessages.map((f) => (
              <div key={f.tempId} className="failed-message-bar">
                <span className="failed-message-text">⚠️ Failed to send: "{f.content.slice(0, 40)}"</span>
                <button className="link-btn" onClick={() => handleRetryFailed(f.tempId)}>Retry</button>
                <button className="failed-message-discard" onClick={() => handleDiscardFailed(f.tempId)}>✕</button>
              </div>
            ))}

            {replyTarget && (
              <div className="reply-strip">
                <span className="reply-strip-text">
                  Replying to <strong>{replyTarget.sender_id === myUserId ? "yourself" : replyTarget.sender_username}</strong>:{" "}
                  {replyTarget.content?.slice(0, 50) || "[media]"}
                </span>
                <button className="reply-strip-cancel" onClick={() => setReplyTarget(null)}>
                  ✕
                </button>
              </div>
            )}

            {typingUsers.length > 0 && (
              <div className="typing-indicator-bar">
                <span className="typing-dots"><span></span><span></span><span></span></span>
                {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing…
              </div>
            )}

            <div className="composer-toolbar">
              <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "sticker" ? null : "sticker")}>
                🌟
              </button>
              <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "emoji" ? null : "emoji")}>
                😊
              </button>
              <button type="button" className="toolbar-btn" onClick={() => setOpenPicker(openPicker === "gif" ? null : "gif")}>
                GIF
              </button>
              <button
                type="button"
                className={`toolbar-btn ${voiceRecorder.isRecording ? "recording" : ""}`}
                onClick={voiceRecorder.isRecording ? undefined : voiceRecorder.startRecording}
                disabled={voiceRecorder.isRecording || videoRecorder.isRecording}
              >
                🎤
              </button>
              <button
                type="button"
                className={`toolbar-btn ${videoRecorder.isRecording ? "recording" : ""}`}
                onClick={videoRecorder.isRecording ? undefined : videoRecorder.startRecording}
                disabled={videoRecorder.isRecording || voiceRecorder.isRecording}
              >
                📹
              </button>
              <button type="button" className="toolbar-btn" onClick={handlePickFile}>
                📎
              </button>
              <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileSelected} />
            </div>

            {voiceRecorder.error && <p className="error-text small-text">{voiceRecorder.error}</p>}
            {videoRecorder.error && <p className="error-text small-text">{videoRecorder.error}</p>}
            {fileError && <p className="error-text small-text">{fileError}</p>}

            {openPicker === "sticker" && <StickerPicker onPick={(id) => send(id, "sticker")} onClose={() => setOpenPicker(null)} />}
            {openPicker === "emoji" && (
              <EmojiPicker onPick={(e) => setDraft((d) => d + e)} onClose={() => setOpenPicker(null)} />
            )}
            {openPicker === "gif" && (
              <GifPicker token={token} onPick={(url) => send(url, "gif")} onClose={() => setOpenPicker(null)} />
            )}

            {videoRecorder.isRecording ? (
              <div className="video-recording-bar">
                <video ref={videoPreviewRef} autoPlay muted playsInline className="video-recording-preview" />
                <div className="video-recording-controls">
                  <span className="recording-dot" />
                  <span className="recording-timer">
                    {Math.floor(videoRecorder.elapsedSeconds / 60)}:{(videoRecorder.elapsedSeconds % 60).toString().padStart(2, "0")}
                  </span>
                  <button type="button" className="link-btn" onClick={videoRecorder.cancelRecording}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn small" onClick={handleSendVideoNote}>
                    Send
                  </button>
                </div>
              </div>
            ) : voiceRecorder.isRecording ? (
              <div className="recording-bar">
                <span className="recording-dot" />
                <span className="recording-timer">
                  {Math.floor(voiceRecorder.elapsedSeconds / 60)}:{(voiceRecorder.elapsedSeconds % 60).toString().padStart(2, "0")}
                </span>
                <span className="recording-hint">Recording…</span>
                <button type="button" className="link-btn" onClick={voiceRecorder.cancelRecording}>
                  Cancel
                </button>
                <button type="button" className="primary-btn small" onClick={handleSendVoice}>
                  Send
                </button>
              </div>
            ) : (
              <form className="send-row" onSubmit={handleSend}>
                <input
                  placeholder={`Message ${activeGroup.group.name}…`}
                  value={draft}
                  onChange={handleDraftChange}
                />
                <button className="primary-btn small" type="submit">
                  Send
                </button>
              </form>
            )}
          </>
        ) : (
          <p className="muted center">Select a group, or create one to get started.</p>
        )}
      </div>
    </div>
  );
}

function PostCard({ post, token, isOwnProfile, onChanged }) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleLike() {
    // Optimistic update — feels instant, corrected below if the request fails.
    setLiked((v) => !v);
    setLikeCount((c) => (liked ? c - 1 : c + 1));
    try {
      await toggleLike(token, post.id);
    } catch (err) {
      setLiked((v) => !v);
      setLikeCount((c) => (liked ? c + 1 : c - 1));
      setError(err.message);
    }
  }

  async function loadComments() {
    try {
      const data = await getComments(token, post.id);
      setComments(data.comments);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleComments() {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && comments === null) loadComments();
  }

  async function handleAddComment(e) {
    e.preventDefault();
    const content = commentDraft.trim();
    if (!content) return;
    try {
      await addComment(token, post.id, content);
      setCommentDraft("");
      loadComments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deletePost(token, post.id);
      onChanged();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="post-card" style={{ opacity: deleting ? 0.4 : 1 }}>
      {post.type === "video" ? (
        <video className="post-media" src={`${BACKEND_URL}/uploads/${post.file_path}`} controls playsInline />
      ) : (
        <audio className="post-media-audio" src={`${BACKEND_URL}/uploads/${post.file_path}`} controls />
      )}

      {post.caption && <p className="post-caption">{post.caption}</p>}

      {error && <p className="error-text small-text">{error}</p>}

      <div className="post-actions">
        <button className={`post-action-btn ${liked ? "liked" : ""}`} onClick={handleLike}>
          {liked ? "💖" : "🤍"} {likeCount}
        </button>
        <button className="post-action-btn" onClick={toggleComments}>
          💬 {comments ? comments.length : post.comment_count}
        </button>
        <a className="post-action-btn" href={`${BACKEND_URL}/uploads/${post.file_path}`} download>
          ⬇️
        </a>
        {isOwnProfile && (
          <button className="post-action-btn danger" onClick={handleDelete} disabled={deleting}>
            🗑️
          </button>
        )}
      </div>

      {commentsOpen && (
        <div className="comments-section">
          {comments === null && <p className="muted small-text">Loading comments…</p>}
          {comments?.map((c) => (
            <div key={c.id} className="comment-row">
              <strong>{c.username}</strong> <span>{c.content}</span>
            </div>
          ))}
          {comments?.length === 0 && <p className="muted small-text">No comments yet.</p>}
          <form className="send-row" onSubmit={handleAddComment}>
            <input
              placeholder="Add a comment…"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
            />
            <button className="primary-btn small" type="submit">
              Post
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ProfilePanel({ token, myUsername }) {
  const [viewingUsername, setViewingUsername] = useState(myUsername);
  const [usernameInput, setUsernameInput] = useState("");
  const [profileData, setProfileData] = useState(null);
  const [error, setError] = useState("");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  async function loadProfile(username) {
    try {
      const data = await getUserPosts(token, username);
      setProfileData(data);
      setViewingUsername(username);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadProfile(myUsername);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUsername]);

  function handleViewProfile(e) {
    e.preventDefault();
    const name = usernameInput.trim();
    if (!name) return;
    loadProfile(name);
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("choose a video or audio file first");
      return;
    }
    setUploading(true);
    setError("");
    try {
      await uploadPost(token, file, uploadCaption.trim());
      setUploadCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadProfile(viewingUsername);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const isOwnProfile = viewingUsername === myUsername;

  return (
    <div className="profile-panel">
      <form className="open-chat-row" onSubmit={handleViewProfile}>
        <input
          placeholder="view profile by username…"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
        />
        <button className="primary-btn small" type="submit">
          View
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {isOwnProfile && (
        <form className="upload-form" onSubmit={handleUpload}>
          <input type="file" accept="video/*,audio/*" ref={fileInputRef} />
          <input
            placeholder="caption (optional)…"
            value={uploadCaption}
            onChange={(e) => setUploadCaption(e.target.value)}
          />
          <button className="primary-btn small" type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Post"}
          </button>
        </form>
      )}

      {profileData && (
        <>
          <div className="conversation-title">
            {profileData.profileUser.username}'s posts · {profileData.posts.length}
          </div>
          <div className="post-feed">
            {profileData.posts.length === 0 && (
              <p className="muted center small-text">No posts yet.</p>
            )}
            {profileData.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                token={token}
                isOwnProfile={isOwnProfile}
                onChanged={() => loadProfile(viewingUsername)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StarredPanel({ token, onOpenConversation }) {
  const [starred, setStarred] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const data = await getStarredMessages(token);
      setStarred(data.starred);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUnstar(item) {
    try {
      if (item.kind === "dm") await starMessage(token, item.messageId);
      else await starGroupMessage(token, item.groupId, item.messageId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="starred-panel">
      {error && <p className="error-text">{error}</p>}
      {starred === null && <p className="muted center small-text">Loading…</p>}
      {starred?.length === 0 && <p className="muted center small-text">No starred messages yet.</p>}
      {starred?.map((item) => (
        <div key={`${item.kind}-${item.messageId}`} className="starred-item">
          <div className="starred-item-meta">
            <span>
              {item.senderUsername} in {item.conversationLabel}
            </span>
            <button className="link-btn" onClick={() => handleUnstar(item)}>
              Unstar
            </button>
          </div>
          <div className="starred-item-content">
            {item.deleted ? "message was deleted" : item.content || "[media]"}
          </div>
          <button
            className="link-btn"
            onClick={() =>
              onOpenConversation(
                item.kind === "dm"
                  ? { kind: "dm", username: item.conversationLabel }
                  : { kind: "group", id: item.groupId }
              )
            }
          >
            Go to conversation →
          </button>
        </div>
      ))}
    </div>
  );
}

function MainShell({ token, myUserId, myUsername, myAvatar, myTheme, onAvatarChange, onThemeChange, onLogout }) {
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("inbox"); // "inbox" | "dm" | "groups" | "profile"
  const [openTarget, setOpenTarget] = useState(null); // { type: "dm", username } | { type: "group", groupId }
  const [socket, setSocket] = useState(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [profileError, setProfileError] = useState("");
  // Lives here (not inside DMPanel/InboxPanel) for the same reason delivery
  // acks do — presence updates should keep the whole app's view of who's
  // online current, not just whichever tab happens to be mounted right now.
  // Keyed by userId -> { online, lastSeenAt }.
  const [presence, setPresence] = useState({});

  const theme = getTheme(myTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const s = connectSocket(token);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    // Delivery acknowledgment has to live here, not inside DMPanel — DMPanel
    // only mounts when the DM tab is active, but "delivered" needs to mean
    // "the app received it," regardless of which tab the person is looking at.
    s.on("message:new", (msg, ack) => {
      if (typeof ack === "function") ack({ received: true });
    });
    s.on("presence:update", ({ userId, online, lastSeenAt }) => {
      setPresence((prev) => ({ ...prev, [userId]: { online, lastSeenAt } }));
    });
    setSocket(s);
    return () => s.disconnect();
  }, [token]);

  async function handleAvatarPick(avatarId) {
    try {
      await updateAvatar(token, avatarId);
      onAvatarChange(avatarId);
      setAvatarPickerOpen(false);
      setProfileError("");
    } catch (err) {
      setProfileError(err.message);
    }
  }

  async function handleThemePick(themeId) {
    try {
      await updateTheme(token, themeId);
      onThemeChange(themeId);
      setThemePickerOpen(false);
      setProfileError("");
    } catch (err) {
      setProfileError(err.message);
    }
  }

  function handleOpenConversation(convo) {
    if (convo.kind === "dm") {
      setTab("dm");
      setOpenTarget({ type: "dm", username: convo.username });
    } else {
      setTab("groups");
      setOpenTarget({ type: "group", groupId: convo.id });
    }
  }

  return (
    <div className="chat-shell wide">
      <AmbientMotif theme={theme} />
      <div className="chat-header">
        <div className="header-left">
          <button className="avatar-trigger" onClick={() => setAvatarPickerOpen((v) => !v)} title="Change avatar">
            <AvatarBadge avatar={getAvatar(myAvatar)} size={30} />
          </button>
          <div>
            <strong style={{ fontFamily: "var(--font-display)" }}>{myUsername}</strong>
            <span className="muted"> is logged in</span>
          </div>
        </div>
        <div className="header-right">
          <button className="theme-trigger" onClick={() => setThemePickerOpen((v) => !v)} title="Change world/theme">
            {theme.motifs[0]}
          </button>
          <span className={`status-dot ${connected ? "online" : "offline"}`} title={connected ? "Live" : "Reconnecting…"} />
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      {profileError && <p className="error-text">{profileError}</p>}

      {avatarPickerOpen && (
        <AvatarPicker current={myAvatar} onPick={handleAvatarPick} onClose={() => setAvatarPickerOpen(false)} />
      )}
      {themePickerOpen && (
        <ThemePicker current={myTheme} onPick={handleThemePick} onClose={() => setThemePickerOpen(false)} />
      )}

      <div className="tab-row">
        <button className={tab === "inbox" ? "tab active" : "tab"} onClick={() => setTab("inbox")}>
          Inbox
        </button>
        <button className={tab === "dm" ? "tab active" : "tab"} onClick={() => setTab("dm")}>
          Direct Messages
        </button>
        <button className={tab === "groups" ? "tab active" : "tab"} onClick={() => setTab("groups")}>
          Groups
        </button>
        <button className={tab === "profile" ? "tab active" : "tab"} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button className={tab === "starred" ? "tab active" : "tab"} onClick={() => setTab("starred")}>
          ⭐
        </button>
      </div>

      {tab === "inbox" && (
        <InboxPanel token={token} myTheme={myTheme} socket={socket} presence={presence} onOpenConversation={handleOpenConversation} />
      )}
      {tab === "dm" && (
        <DMPanel token={token} myUserId={myUserId} socket={socket} openTarget={openTarget} myTheme={myTheme} presence={presence} />
      )}
      {tab === "groups" && (
        <GroupsPanel token={token} myUserId={myUserId} socket={socket} openTarget={openTarget} myTheme={myTheme} />
      )}
      {tab === "profile" && <ProfilePanel token={token} myUsername={myUsername} />}
      {tab === "starred" && <StarredPanel token={token} onOpenConversation={handleOpenConversation} />}
    </div>
  );
}

function App() {
  useThemeFonts();

  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("anichat_session");
    return saved ? JSON.parse(saved) : null;
  });

  function handleAuthed(token, user) {
    const s = { token, userId: user.id, username: user.username, avatar: user.avatar, theme: user.theme };
    localStorage.setItem("anichat_session", JSON.stringify(s));
    setSession(s);
  }

  function handleAvatarChange(avatarId) {
    setSession((prev) => {
      const updated = { ...prev, avatar: avatarId };
      localStorage.setItem("anichat_session", JSON.stringify(updated));
      return updated;
    });
  }

  function handleThemeChange(themeId) {
    setSession((prev) => {
      const updated = { ...prev, theme: themeId };
      localStorage.setItem("anichat_session", JSON.stringify(updated));
      return updated;
    });
  }

  function handleLogout() {
    localStorage.removeItem("anichat_session");
    setSession(null);
  }

  return (
    <div className="page">
      {session ? (
        <MainShell
          token={session.token}
          myUserId={session.userId}
          myUsername={session.username}
          myAvatar={session.avatar}
          myTheme={session.theme}
          onAvatarChange={handleAvatarChange}
          onThemeChange={handleThemeChange}
          onLogout={handleLogout}
        />
      ) : (
        <AuthScreen onAuthed={handleAuthed} />
      )}
    </div>
  );
}

export default App;
