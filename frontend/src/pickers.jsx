import { useState } from "react";
import { AVATAR_OPTIONS, STICKERS, QUICK_EMOJI } from "./constants";
import { THEME_OPTIONS } from "./themes";
import { searchGifs } from "./api";

export function AvatarBadge({ avatar, size = 28 }) {
  return (
    <span
      className="avatar-badge"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `linear-gradient(135deg, ${avatar.gradient[0]}, ${avatar.gradient[1]})`,
      }}
    >
      {avatar.emoji}
    </span>
  );
}

export function AvatarPicker({ current, onPick, onClose }) {
  return (
    <div className="popover">
      <div className="popover-header">
        <span>Choose your avatar</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <div className="avatar-grid">
        {AVATAR_OPTIONS.map((a) => (
          <button
            key={a.id}
            className={`avatar-option ${current === a.id ? "selected" : ""}`}
            onClick={() => onPick(a.id)}
            title={a.id}
          >
            <AvatarBadge avatar={a} size={36} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function StickerPicker({ onPick, onClose }) {
  return (
    <div className="popover">
      <div className="popover-header">
        <span>Send a sticker</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <div className="sticker-grid">
        {STICKERS.map((s) => (
          <button key={s.id} className="sticker-option" onClick={() => onPick(s.id)}>
            <div className="sticker-option-glyph">{s.glyph}</div>
            <div className="sticker-option-label">{s.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmojiPicker({ onPick, onClose }) {
  return (
    <div className="popover">
      <div className="popover-header">
        <span>Insert emoji</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <div className="emoji-grid">
        {QUICK_EMOJI.map((e) => (
          <button key={e} className="emoji-option" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GifPicker({ token, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await searchGifs(token, query.trim());
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="popover popover-wide">
      <div className="popover-header">
        <span>Send a GIF</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <form className="gif-search-row" onSubmit={handleSearch}>
        <input
          placeholder="search gifs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="primary-btn small" type="submit" disabled={loading}>
          {loading ? "…" : "Go"}
        </button>
      </form>

      {error && <p className="error-text small-text">{error}</p>}
      {!error && searched && results.length === 0 && !loading && (
        <p className="muted center small-text">No results — try another search.</p>
      )}

      <div className="gif-grid">
        {results.map((r) => (
          <button key={r.id} className="gif-option" onClick={() => onPick(r.fullUrl)}>
            <img src={r.previewUrl} alt={r.title} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemePicker({ current, onPick, onClose }) {
  return (
    <div className="popover">
      <div className="popover-header">
        <span>Choose your world</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <div className="theme-grid">
        {THEME_OPTIONS.map((t) => (
          <button
            key={t.id}
            className={`theme-option ${current === t.id ? "selected" : ""}`}
            onClick={() => onPick(t.id)}
          >
            <span
              className="theme-swatch"
              style={{ background: `linear-gradient(135deg, ${t.colors.accent}, ${t.colors.accentDeep})` }}
            >
              {t.motifs[0]}
            </span>
            <span>
              <div className="theme-option-name" style={{ fontFamily: t.fontDisplay }}>{t.name}</div>
              <div className="theme-option-motifs">{t.motifs.join(" ")}</div>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AmbientMotif({ theme }) {
  const particles = [...Array(8)];
  return (
    <>
      {particles.map((_, i) => (
        <span
          key={i}
          className="ambient-motif"
          style={{
            left: `${6 + i * 12}%`,
            animationDuration: `${9 + (i % 4) * 2}s`,
            animationDelay: `${i * 1.3}s`,
          }}
        >
          {theme.motifs[i % theme.motifs.length]}
        </span>
      ))}
    </>
  );
}

export function PinnedBar({ pinnedMessages, onUnpin, canUnpin }) {
  const [expanded, setExpanded] = useState(false);
  if (!pinnedMessages || pinnedMessages.length === 0) return null;

  const visible = expanded ? pinnedMessages : pinnedMessages.slice(0, 1);

  return (
    <div className="pinned-bar">
      {visible.map((m) => (
        <div key={m.id} className="pinned-item">
          <span className="pinned-icon">📌</span>
          <span className="pinned-content">{m.deleted_at ? "message was deleted" : m.content || "[media]"}</span>
          {canUnpin && (
            <button className="pinned-unpin" onClick={() => onUnpin(m.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {pinnedMessages.length > 1 && (
        <button className="pinned-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `+${pinnedMessages.length - 1} more pinned`}
        </button>
      )}
    </div>
  );
}

export function MessageContent({ message, mine }) {
  const replyPreview = message.replyTo && (
    <div className="reply-preview">
      <span className="reply-preview-sender">{message.replyTo.senderUsername}</span>
      <span className="reply-preview-content">
        {message.replyTo.deleted ? "message was deleted" : message.replyTo.content || "[media]"}
      </span>
    </div>
  );

  const forwardedLabel = message.forwarded_from_username && (
    <div className="forwarded-label">↪ Forwarded from {message.forwarded_from_username}</div>
  );

  if (message.deleted_at) {
    return <div className={`bubble deleted ${mine ? "mine" : ""}`}>🗑️ This message was deleted</div>;
  }

  if (message.type === "sticker") {
    const sticker = STICKERS.find((s) => s.id === message.content) || { glyph: "❓", label: message.content };
    return (
      <div className={`sticker-message ${mine ? "mine" : ""}`}>
        {forwardedLabel}
        {replyPreview}
        <div className="sticker-message-glyph">{sticker.glyph}</div>
        <div className="sticker-message-label">{sticker.label}</div>
      </div>
    );
  }

  if (message.type === "gif") {
    return (
      <div className="gif-message">
        {forwardedLabel}
        {replyPreview}
        <img src={message.content} alt="gif" loading="lazy" />
      </div>
    );
  }

  return (
    <div className={`bubble ${mine ? "mine" : ""}`}>
      {forwardedLabel}
      {replyPreview}
      {message.content}
      {message.edited_at && <span className="edited-label"> (edited)</span>}
    </div>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function ReactionBar({ reactions, myUserId, onToggle }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="reaction-bar">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`reaction-pill ${r.userIds?.includes(myUserId) ? "mine" : ""}`}
          onClick={() => onToggle(r.emoji)}
        >
          {r.emoji} {r.count}
        </button>
      ))}
    </div>
  );
}

export function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="popover reaction-picker-popover">
      <div className="popover-header">
        <span>React</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <div className="reaction-picker-grid">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} className="emoji-option" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ForwardPicker({ groups, onForwardToUser, onForwardToGroup, onClose }) {
  const [username, setUsername] = useState("");

  function handleUserSubmit(e) {
    e.preventDefault();
    if (username.trim()) onForwardToUser(username.trim());
  }

  return (
    <div className="popover">
      <div className="popover-header">
        <span>Forward message</span>
        <button className="popover-close" onClick={onClose}>✕</button>
      </div>
      <form className="forward-user-row" onSubmit={handleUserSubmit}>
        <input placeholder="forward to username…" value={username} onChange={(e) => setUsername(e.target.value)} />
        <button className="primary-btn small" type="submit">Send</button>
      </form>
      {groups?.length > 0 && (
        <>
          <div className="forward-divider">or forward to a group</div>
          <div className="forward-group-list">
            {groups.map((g) => (
              <button key={g.id} className="forward-group-item" onClick={() => onForwardToGroup(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MessageActions({
  canEdit,
  canDeleteEveryone,
  canPin,
  isPinned,
  isStarred,
  onReply,
  onReact,
  onForward,
  onPin,
  onStar,
  onEdit,
  onDeleteMe,
  onDeleteEveryone,
}) {
  const [open, setOpen] = useState(false);

  function act(fn) {
    return () => {
      setOpen(false);
      fn();
    };
  }

  return (
    <div className="message-actions">
      <button className="message-actions-trigger" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="message-actions-menu">
          <button onClick={act(onReact)}>😊 React</button>
          <button onClick={act(onReply)}>↩️ Reply</button>
          <button onClick={act(onForward)}>➡️ Forward</button>
          <button onClick={act(onStar)}>{isStarred ? "⭐ Unstar" : "☆ Star"}</button>
          {canPin && <button onClick={act(onPin)}>{isPinned ? "📌 Unpin" : "📌 Pin"}</button>}
          {canEdit && <button onClick={act(onEdit)}>✏️ Edit</button>}
          <button onClick={act(onDeleteMe)}>🙈 Delete for me</button>
          {canDeleteEveryone && <button onClick={act(onDeleteEveryone)}>🗑️ Delete for everyone</button>}
        </div>
      )}
    </div>
  );
}

export function EditMessageForm({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);

  function handleSubmit(e) {
    e.preventDefault();
    if (value.trim()) onSave(value.trim());
  }

  return (
    <form className="edit-message-form" onSubmit={handleSubmit}>
      <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="edit-message-actions">
        <button className="primary-btn small" type="submit">
          Save
        </button>
        <button className="link-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
