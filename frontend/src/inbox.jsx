import { useCallback, useEffect, useState } from "react";
import { getConversations, unarchiveDm, unarchiveGroup } from "./api";
import { AvatarBadge, PresenceLabel } from "./pickers";
import { getAvatar } from "./constants";
import { getVoice } from "./voices";

function formatRelativeTime(iso) {
  const date = new Date(iso);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString();
}

function previewText(lastMessage) {
  if (!lastMessage) return "No messages yet";
  if (lastMessage.type === "sticker") return "🌟 Sticker";
  if (lastMessage.type === "gif") return "GIF";
  if (lastMessage.type === "system") return lastMessage.content || "";
  const content = lastMessage.content || "";
  return content.length > 40 ? content.slice(0, 40) + "…" : content;
}

export function InboxPanel({ token, myTheme, socket, presence, onOpenConversation }) {
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const voice = getVoice(myTheme);

  const refresh = useCallback(async () => {
    try {
      const data = await getConversations(token, { archived: showArchived });
      setConversations(data.conversations);
    } catch (err) {
      setError(err.message);
    }
  }, [token, showArchived]);

  useEffect(() => {
    setConversations(null); // show "Loading…" while switching views, avoids a flash of the old list
    refresh();
  }, [refresh]);

  // Any relevant real-time event means the list (order, previews, unread counts) may be stale.
  useEffect(() => {
    if (!socket) return;
    function handleAny() {
      refresh();
    }
    socket.on("message:new", handleAny);
    socket.on("group_message:new", handleAny);
    socket.on("group:event", handleAny);
    return () => {
      socket.off("message:new", handleAny);
      socket.off("group_message:new", handleAny);
      socket.off("group:event", handleAny);
    };
  }, [socket, refresh]);

  async function handleUnarchive(e, c) {
    e.stopPropagation(); // don't also open the conversation
    try {
      if (c.kind === "dm") await unarchiveDm(token, c.username);
      else await unarchiveGroup(token, c.id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="inbox-panel">
      <div className="inbox-view-toggle">
        <button className={!showArchived ? "active" : ""} onClick={() => setShowArchived(false)}>
          Chats
        </button>
        <button className={showArchived ? "active" : ""} onClick={() => setShowArchived(true)}>
          📥 Archived
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {conversations === null && <p className="muted center small-text">Loading…</p>}
      {conversations?.length === 0 && (
        <p className="muted center small-text">{showArchived ? "No archived chats." : voice.emptyConversations}</p>
      )}

      <div className="inbox-list">
        {conversations?.map((c) => {
          const livePresence = c.kind === "dm" ? presence?.[c.id] : null;
          const online = livePresence ? livePresence.online : c.online;
          const lastSeenAt = livePresence ? livePresence.lastSeenAt : c.lastSeenAt;
          return (
            <button key={`${c.kind}-${c.id}`} className="inbox-row" onClick={() => onOpenConversation(c)}>
              {c.kind === "dm" ? (
                <span className="inbox-avatar-wrap">
                  <AvatarBadge avatar={getAvatar(c.avatar)} size={36} />
                  {online && <span className="inbox-online-dot" title="Online" />}
                </span>
              ) : (
                <span className="inbox-group-icon">👥</span>
              )}
              <div className="inbox-row-main">
                <div className="inbox-row-top">
                  <span className="inbox-row-name">{c.kind === "dm" ? c.username : c.name}</span>
                  {c.muted && <span className="inbox-muted-icon" title="Muted">🔕</span>}
                  {c.lastActivityAt && <span className="inbox-row-time">{formatRelativeTime(c.lastActivityAt)}</span>}
                </div>
                <div className="inbox-row-bottom">
                  <span className="inbox-row-preview">{previewText(c.lastMessage)}</span>
                  {c.unreadCount > 0 && (
                    <span className={`inbox-unread-badge ${c.muted ? "muted" : ""}`}>{c.unreadCount}</span>
                  )}
                </div>
                {c.kind === "dm" && <PresenceLabel online={online} lastSeenAt={lastSeenAt} compact />}
              </div>
              {showArchived && (
                <span className="inbox-unarchive-btn" onClick={(e) => handleUnarchive(e, c)} title="Unarchive">
                  📤
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

