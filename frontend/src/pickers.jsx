import { useState, useRef, useEffect } from "react";
import { AVATAR_OPTIONS, STICKERS, QUICK_EMOJI } from "./constants";
import { THEME_OPTIONS } from "./themes";
import { searchGifs, BACKEND_URL } from "./api";

function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatLastSeen(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// Mute toggle + duration picker, shared between the DM header and group
// header. Muting is purely a personal preference (no notification system
// exists yet to actually gate — see README) but the state, the UI, and the
// auto-expiry are all real and ready for that to plug into later.
export function MuteButton({ muted, mutedUntil, onMute, onUnmute }) {
  const [open, setOpen] = useState(false);

  if (muted) {
    const label = mutedUntil
      ? `Muted until ${new Date(mutedUntil).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "Muted";
    return (
      <button className="mute-toggle-btn muted" onClick={onUnmute} title={`${label} — click to unmute`}>
        🔕
      </button>
    );
  }

  return (
    <div className="mute-popover-wrap">
      <button className="mute-toggle-btn" onClick={() => setOpen((v) => !v)} title="Mute this chat">
        🔔
      </button>
      {open && (
        <div className="popover mute-duration-popover">
          <button onClick={() => { onMute(8); setOpen(false); }}>Mute 8 hours</button>
          <button onClick={() => { onMute(24 * 7); setOpen(false); }}>Mute 1 week</button>
          <button onClick={() => { onMute(null); setOpen(false); }}>Mute always</button>
        </div>
      )}
    </div>
  );
}

// Shared between the DM header and the inbox list so "online" / "last seen"
// reads identically everywhere it shows up. `lastSeenAt` being null while
// offline just means we've never recorded a disconnect for them yet (e.g.
// a brand new account) — nothing to show in that case, not an error.
export function PresenceLabel({ online, lastSeenAt, compact }) {
  if (online) return <span className="presence-label online">{compact ? "●" : "● Online"}</span>;
  const rel = formatLastSeen(lastSeenAt);
  if (!rel) return null;
  return <span className="presence-label offline">{compact ? rel : `Last seen ${rel}`}</span>;
}

export function VoiceMessagePlayer({ src, durationSeconds, mine }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [knownDuration, setKnownDuration] = useState(durationSeconds || 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onLoaded = () => {
      if (audio.duration && Number.isFinite(audio.duration)) setKnownDuration(audio.duration);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  }

  const progress = knownDuration > 0 ? Math.min(1, currentTime / knownDuration) : 0;
  const barCount = 18;

  return (
    <div className={`voice-message ${mine ? "mine" : ""}`}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      <button className="voice-play-btn" onClick={togglePlay}>
        {playing ? "⏸" : "▶"}
      </button>
      <div className="voice-waveform">
        {[...Array(barCount)].map((_, i) => (
          <span key={i} className={i / barCount < progress ? "played" : ""} style={{ height: `${20 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <span className="voice-duration">{formatDuration(playing || currentTime > 0 ? currentTime : knownDuration)}</span>
    </div>
  );
}

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

export function VideoNotePlayer({ src, durationSeconds }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      video.play().catch(() => {});
      setPlaying(true);
    }
  }

  return (
    <div className="video-note" onClick={togglePlay}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        onEnded={() => setPlaying(false)}
        className="video-note-el"
      />
      {!playing && <span className="video-note-play-overlay">▶</span>}
      <span className="video-note-duration">{formatDuration(durationSeconds)}</span>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Generic file-preview card — deliberately not trying to render a type-specific
// icon per extension; a single document glyph keeps this from needing an
// ever-growing icon set as new file types get shared.
export function FileMessageCard({ src, fileName, fileSizeBytes, mine }) {
  return (
    <a
      className={`file-message ${mine ? "mine" : ""}`}
      href={src}
      download={fileName || undefined}
      target="_blank"
      rel="noreferrer"
    >
      <span className="file-message-icon">📄</span>
      <div className="file-message-info">
        <span className="file-message-name">{fileName || "file"}</span>
        <span className="file-message-size">{formatFileSize(fileSizeBytes)}</span>
      </div>
      <span className="file-message-download">⬇</span>
    </a>
  );
}

// Compressed photo — shown at chat-bubble size using the server-generated
// thumbnail (fast to load), full resolution opens in a new tab on click.
export function ImageMessage({ thumbSrc, fullSrc, mine }) {
  return (
    <a href={fullSrc} target="_blank" rel="noreferrer" className={`image-message ${mine ? "mine" : ""}`}>
      <img src={thumbSrc} alt="shared photo" loading="lazy" />
    </a>
  );
}

// Compressed video — a normal (non-circular) inline player, distinct from
// VideoNotePlayer's circular in-app-recorded clips. Uses the server-generated
// poster frame so the bubble doesn't need to download the video to render.
export function VideoMessage({ src, posterSrc, durationSeconds }) {
  return (
    <div className="video-message">
      <video src={src} poster={posterSrc} controls playsInline preload="metadata" />
      {durationSeconds != null && <span className="video-message-duration">{formatDuration(durationSeconds)}</span>}
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

  if (message.type === "voice") {
    return (
      <div>
        {forwardedLabel}
        {replyPreview}
        <VoiceMessagePlayer
          src={`${BACKEND_URL}/uploads/${message.content}`}
          durationSeconds={message.voice_duration_seconds}
          mine={mine}
        />
      </div>
    );
  }

  if (message.type === "video_note") {
    return (
      <div>
        {forwardedLabel}
        {replyPreview}
        <VideoNotePlayer src={`${BACKEND_URL}/uploads/${message.content}`} durationSeconds={message.video_duration_seconds} />
      </div>
    );
  }

  if (message.type === "file") {
    return (
      <div>
        {forwardedLabel}
        {replyPreview}
        <FileMessageCard
          src={`${BACKEND_URL}/uploads/${message.content}`}
          fileName={message.file_name}
          fileSizeBytes={message.file_size_bytes}
          mine={mine}
        />
      </div>
    );
  }

  if (message.type === "image") {
    return (
      <div>
        {forwardedLabel}
        {replyPreview}
        <ImageMessage
          thumbSrc={`${BACKEND_URL}/uploads/${message.thumbnail_path || message.content}`}
          fullSrc={`${BACKEND_URL}/uploads/${message.content}`}
          mine={mine}
        />
      </div>
    );
  }

  if (message.type === "video") {
    return (
      <div>
        {forwardedLabel}
        {replyPreview}
        <VideoMessage
          src={`${BACKEND_URL}/uploads/${message.content}`}
          posterSrc={message.thumbnail_path ? `${BACKEND_URL}/uploads/${message.thumbnail_path}` : undefined}
          durationSeconds={message.video_duration_seconds}
        />
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
