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

export function MessageContent({ message, mine }) {
  const replyPreview = message.replyTo && (
    <div className="reply-preview">
      <span className="reply-preview-sender">{message.replyTo.senderUsername}</span>
      <span className="reply-preview-content">
        {message.replyTo.deleted ? "message was deleted" : message.replyTo.content || "[media]"}
      </span>
    </div>
  );

  if (message.deleted_at) {
    return <div className={`bubble deleted ${mine ? "mine" : ""}`}>🗑️ This message was deleted</div>;
  }

  if (message.type === "sticker") {
    const sticker = STICKERS.find((s) => s.id === message.content) || { glyph: "❓", label: message.content };
    return (
      <div className={`sticker-message ${mine ? "mine" : ""}`}>
        {replyPreview}
        <div className="sticker-message-glyph">{sticker.glyph}</div>
        <div className="sticker-message-label">{sticker.label}</div>
      </div>
    );
  }

  if (message.type === "gif") {
    return (
      <div className="gif-message">
        {replyPreview}
        <img src={message.content} alt="gif" loading="lazy" />
      </div>
    );
  }

  return (
    <div className={`bubble ${mine ? "mine" : ""}`}>
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

export function MessageActions({ canEdit, canDeleteEveryone, onReply, onReact, onEdit, onDeleteMe, onDeleteEveryone }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="message-actions">
      <button className="message-actions-trigger" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="message-actions-menu">
          <button
            onClick={() => {
              setOpen(false);
              onReact();
            }}
          >
            😊 React
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onReply();
            }}
          >
            ↩️ Reply
          </button>
          {canEdit && (
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              ✏️ Edit
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              onDeleteMe();
            }}
          >
            🙈 Delete for me
          </button>
          {canDeleteEveryone && (
            <button
              onClick={() => {
                setOpen(false);
                onDeleteEveryone();
              }}
            >
              🗑️ Delete for everyone
            </button>
          )}
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
