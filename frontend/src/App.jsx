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
  BACKEND_URL,
} from "./api";
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
      <p className="subtitle">Milestone 12 — Reply, Reactions &amp; Promote</p>

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

function DMPanel({ token, myUserId, socket, openTarget, myTheme }) {
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
  const scrollRef = useRef(null);
  const activeChatRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const otherTypingTimeoutRef = useRef(null);

  async function loadConversation(withUsername) {
    try {
      const data = await getConversation(token, withUsername);
      setMessages(data.messages);
      setActiveChat(data.otherUser);
      activeChatRef.current = data.otherUser;
      setOtherUserReadUpTo(data.otherUserReadUpTo);
      setOtherTyping(false);
      setError("");
      markDmRead(token, withUsername).catch(() => {});
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
    socket.on("message:new", handleNewMessage);
    socket.on("message:delivered", handleDelivered);
    socket.on("dm:read", handleRead);
    socket.on("typing:dm", handleTyping);
    socket.on("message:edited", handleEdited);
    socket.on("message:deleted", handleDeleted);
    socket.on("message:reaction", handleReaction);
    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("message:delivered", handleDelivered);
      socket.off("dm:read", handleRead);
      socket.off("typing:dm", handleTyping);
      socket.off("message:edited", handleEdited);
      socket.off("message:deleted", handleDeleted);
      socket.off("message:reaction", handleReaction);
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
    try {
      await sendMessage(token, activeChat.username, content, type, replyTarget?.id || null);
      if (type === "text") setDraft("");
      setOpenPicker(null);
      setReplyTarget(null);
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

      {activeChat && (
        <>
          <div className="conversation-title with-avatar">
            <AvatarBadge avatar={getAvatar(activeChat.avatar)} size={22} />
            Conversation with {activeChat.username}
          </div>
          <div ref={scrollRef} className="message-list">
            {messages.length === 0 && <p className="muted center">{getVoice(myTheme).emptyDm}</p>}
            {messages.map((m) => {
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
                      </div>
                    )}
                    {!m.deleted_at && editingId !== m.id && (
                      <MessageActions
                        canEdit={mine && m.type === "text"}
                        canDeleteEveryone={mine}
                        onReply={() => setReplyTarget(m)}
                        onReact={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
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
          </div>

          {openPicker === "sticker" && <StickerPicker onPick={(id) => send(id, "sticker")} onClose={() => setOpenPicker(null)} />}
          {openPicker === "emoji" && (
            <EmojiPicker onPick={(e) => setDraft((d) => d + e)} onClose={() => setOpenPicker(null)} />
          )}
          {openPicker === "gif" && (
            <GifPicker token={token} onPick={(url) => send(url, "gif")} onClose={() => setOpenPicker(null)} />
          )}

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
        </>
      )}
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
  const [openPicker, setOpenPicker] = useState(null); // "sticker" | "emoji" | "gif" | null
  const [typingUsers, setTypingUsers] = useState([]); // usernames currently typing in the open group
  const scrollRef = useRef(null);
  const activeGroupIdRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const typingClearTimersRef = useRef({});

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
      setError("");
      markGroupRead(token, groupId).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  }

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
    try {
      await sendGroupMessage(token, activeGroup.group.id, content, type, replyTarget?.id || null);
      if (type === "text") setDraft("");
      setOpenPicker(null);
      setReplyTarget(null);
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

    socket.on("group_message:new", handleGroupMessage);
    socket.on("group:event", handleGroupEvent);
    socket.on("typing:group", handleGroupTyping);
    socket.on("group_message:edited", handleGroupEdited);
    socket.on("group_message:deleted", handleGroupDeleted);
    socket.on("group_message:reaction", handleGroupReaction);
    socket.on("group:role_changed", handleRoleChanged);
    return () => {
      socket.off("group_message:new", handleGroupMessage);
      socket.off("group:event", handleGroupEvent);
      socket.off("typing:group", handleGroupTyping);
      socket.off("group_message:edited", handleGroupEdited);
      socket.off("group_message:deleted", handleGroupDeleted);
      socket.off("group_message:reaction", handleGroupReaction);
      socket.off("group:role_changed", handleRoleChanged);
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
            </div>

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

            <div ref={scrollRef} className="message-list">
              {activeGroup.messages.map((m) =>
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
                        </div>
                      )}
                      {!m.deleted_at && editingId !== m.id && (
                        <MessageActions
                          canEdit={m.sender_id === myUserId && m.type === "text"}
                          canDeleteEveryone={m.sender_id === myUserId || isAdmin}
                          onReply={() => setReplyTarget(m)}
                          onReact={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
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
            </div>

            {openPicker === "sticker" && <StickerPicker onPick={(id) => send(id, "sticker")} onClose={() => setOpenPicker(null)} />}
            {openPicker === "emoji" && (
              <EmojiPicker onPick={(e) => setDraft((d) => d + e)} onClose={() => setOpenPicker(null)} />
            )}
            {openPicker === "gif" && (
              <GifPicker token={token} onPick={(url) => send(url, "gif")} onClose={() => setOpenPicker(null)} />
            )}

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

function MainShell({ token, myUserId, myUsername, myAvatar, myTheme, onAvatarChange, onThemeChange, onLogout }) {
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("inbox"); // "inbox" | "dm" | "groups" | "profile"
  const [openTarget, setOpenTarget] = useState(null); // { type: "dm", username } | { type: "group", groupId }
  const [socket, setSocket] = useState(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [profileError, setProfileError] = useState("");

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
      </div>

      {tab === "inbox" && (
        <InboxPanel token={token} myTheme={myTheme} socket={socket} onOpenConversation={handleOpenConversation} />
      )}
      {tab === "dm" && (
        <DMPanel token={token} myUserId={myUserId} socket={socket} openTarget={openTarget} myTheme={myTheme} />
      )}
      {tab === "groups" && (
        <GroupsPanel token={token} myUserId={myUserId} socket={socket} openTarget={openTarget} myTheme={myTheme} />
      )}
      {tab === "profile" && <ProfilePanel token={token} myUsername={myUsername} />}
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
