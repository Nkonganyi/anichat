import { useState, useRef, useEffect } from "react";
import { AVATAR_OPTIONS, STICKERS, QUICK_EMOJI, getAvatar } from "./constants";
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

// Overflow menu for chat-level actions that don't warrant their own header
// icon (unlike Mute, which is frequent enough to deserve a one-click
// toggle). "Delete conversation" needs a real confirm step since it's
// irreversible — rather than a native window.confirm() (which clashes with
// the rest of this app's custom UI), clicking it once arms a "Click again
// to confirm" state that quietly disarms itself after a few seconds or if
// the menu closes.
// Replaces the message composer when either side has blocked the other.
// Deliberately doesn't say WHO blocked whom when they blocked you (no need
// to advertise that), but does say so when it's your own block, since you're
// the one who can undo it.
export function BlockedBanner({ blockedByMe, blockedMe, onUnblock }) {
  if (blockedByMe) {
    return (
      <div className="blocked-banner">
        <span>You've blocked this user. They can't message you, and you can't message them.</span>
        <button onClick={onUnblock}>Unblock</button>
      </div>
    );
  }
  if (blockedMe) {
    return (
      <div className="blocked-banner">
        <span>You can't send messages in this conversation.</span>
      </div>
    );
  }
  return null;
}

// @mention autocomplete dropdown — appears above the group message input
// while typing "@partial". Only ever offers real group members (matches
// what the backend will actually turn into a mention record), so there's
// no risk of it suggesting someone whose @mention wouldn't even count.
export function MentionAutocomplete({ query, members, onSelect }) {
  const matches = members
    .filter((m) => m.username.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 6);

  if (matches.length === 0) return null;

  return (
    <div className="mention-autocomplete">
      {matches.map((m) => (
        <button type="button" key={m.username} className="mention-autocomplete-item" onClick={() => onSelect(m.username)}>
          <AvatarBadge avatar={getAvatar(m.avatar)} size={20} />
          <span>{m.username}</span>
          {m.role !== "member" && <span className="mention-autocomplete-role">{m.role}</span>}
        </button>
      ))}
    </div>
  );
}

// Invite link management — create/list/revoke, for admins/owner. Opened
// from the ⋮ menu, rendered as its own popover (not nested inside
// ChatOptionsMenu's popover, to avoid popover-in-popover awkwardness).
export function InviteLinkPanel({ invites, onCreate, onRevoke, onClose }) {
  const [expiryChoice, setExpiryChoice] = useState("never");
  const [usesChoice, setUsesChoice] = useState("unlimited");
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);

  async function handleCreate() {
    setCreating(true);
    try {
      const expiresInHours = expiryChoice === "24h" ? 24 : expiryChoice === "7d" ? 24 * 7 : null;
      const maxUses = usesChoice === "unlimited" ? null : parseInt(usesChoice, 10);
      await onCreate({ expiresInHours, maxUses });
    } finally {
      setCreating(false);
    }
  }

  function handleCopy(inviteToken) {
    const url = `${window.location.origin}/invite/${inviteToken}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedToken(inviteToken);
        setTimeout(() => setCopiedToken(null), 2000);
      })
      .catch(() => {}); // clipboard access can be denied — the link is still visible/selectable either way
  }

  return (
    <div className="popover invite-link-panel" onClick={(e) => e.stopPropagation()}>
      <div className="invite-panel-header">
        <span>Invite links</span>
        <button type="button" className="invite-panel-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="invite-create-row">
        <select value={expiryChoice} onChange={(e) => setExpiryChoice(e.target.value)}>
          <option value="never">Never expires</option>
          <option value="24h">Expires in 24h</option>
          <option value="7d">Expires in 7 days</option>
        </select>
        <select value={usesChoice} onChange={(e) => setUsesChoice(e.target.value)}>
          <option value="unlimited">Unlimited uses</option>
          <option value="1">1 use</option>
          <option value="10">10 uses</option>
        </select>
        <button type="button" className="primary-btn small" onClick={handleCreate} disabled={creating}>
          {creating ? "…" : "Create"}
        </button>
      </div>

      <div className="invite-list">
        {invites.length === 0 && <p className="muted small-text">No active invite links yet.</p>}
        {invites.map((inv) => (
          <div key={inv.token} className="invite-row">
            <div className="invite-row-info">
              <span className="invite-row-meta">
                {inv.max_uses ? `${inv.use_count}/${inv.max_uses} uses` : `${inv.use_count} uses`}
                {inv.expires_at && ` · expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                {inv.isExpired && " · expired"}
                {inv.isExhausted && " · exhausted"}
              </span>
            </div>
            <button type="button" onClick={() => handleCopy(inv.token)}>
              {copiedToken === inv.token ? "Copied!" : "Copy"}
            </button>
            <button type="button" className="danger" onClick={() => onRevoke(inv.token)}>
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Group icon — a custom square image if one's been set, otherwise the
// default 👥. Clickable (admins/owner only) to open a file picker; the
// actual square-cropping happens server-side (see backend/routes/groups.js),
// so there's no client-side crop UI to build here.
export function GroupIconBadge({ iconPath, size = 40, canEdit, onUpload }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <span
      className={`group-icon-badge ${canEdit ? "editable" : ""}`}
      style={{ width: size, height: size }}
      onClick={canEdit ? () => fileInputRef.current?.click() : undefined}
      title={canEdit ? "Change group icon" : undefined}
    >
      {iconPath ? (
        <img src={`${BACKEND_URL}/uploads/${iconPath}`} alt="" style={{ width: size, height: size }} />
      ) : (
        <span className="group-icon-fallback" style={{ fontSize: size * 0.5 }}>
          👥
        </span>
      )}
      {uploading && <span className="group-icon-uploading">…</span>}
      {canEdit && (
        <input type="file" ref={fileInputRef} accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
      )}
    </span>
  );
}

// Group description/topic — a blurb visible to all members, editable inline
// by admins/owner. Click-to-edit rather than a separate settings page,
// since it's small enough not to need its own screen.
export function GroupDescriptionBar({ description, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(description || "");
  }, [description]);

  if (editing) {
    return (
      <div className="group-description-edit">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="What's this group about?"
          rows={2}
          autoFocus
        />
        <div className="group-description-edit-row">
          <span className="group-description-counter">{draft.length}/500</span>
          <button
            type="button"
            onClick={() => {
              setDraft(description || "");
              setEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn small"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft.trim());
                setEditing(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (!description && !canEdit) return null; // nothing to show, no permission to add one

  return (
    <div className={`group-description-bar ${canEdit ? "editable" : ""}`} onClick={canEdit ? () => setEditing(true) : undefined}>
      {description ? (
        <span className="group-description-text">{description}</span>
      ) : (
        <span className="group-description-placeholder">Add a group description…</span>
      )}
      {canEdit && <span className="group-description-edit-icon">✏️</span>}
    </div>
  );
}

export function ChatOptionsMenu({
  archived,
  onArchive,
  onUnarchive,
  onDeleteConversation,
  blockedByMe,
  onBlock,
  onUnblock,
  hasGroupIcon,
  onRemoveGroupIcon,
  onOpenInviteLinks,
  onLeaveGroup,
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  function close() {
    setOpen(false);
    setConfirmingDelete(false);
    setConfirmingBlock(false);
    setConfirmingLeave(false);
  }

  function handleLeaveClick() {
    if (!confirmingLeave) {
      setConfirmingLeave(true);
      setTimeout(() => setConfirmingLeave(false), 4000);
      return;
    }
    onLeaveGroup();
    close();
  }

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    onDeleteConversation();
    close();
  }

  function handleBlockClick() {
    if (blockedByMe) {
      onUnblock();
      close();
      return;
    }
    if (!confirmingBlock) {
      setConfirmingBlock(true);
      setTimeout(() => setConfirmingBlock(false), 4000);
      return;
    }
    onBlock();
    close();
  }

  return (
    <div className="chat-options-wrap">
      <button
        className="chat-options-btn"
        onClick={() => (open ? close() : setOpen(true))}
        title="Chat options"
      >
        ⋮
      </button>
      {open && (
        <div className="popover chat-options-popover">
          <button
            onClick={() => {
              archived ? onUnarchive() : onArchive();
              close();
            }}
          >
            {archived ? "📤 Unarchive chat" : "📥 Archive chat"}
          </button>
          {/* onRemoveGroupIcon is only passed in for groups that currently have a custom icon */}
          {onRemoveGroupIcon && hasGroupIcon && (
            <button
              onClick={() => {
                onRemoveGroupIcon();
                close();
              }}
            >
              🖼️ Remove group icon
            </button>
          )}
          {/* onOpenInviteLinks is only passed in for groups (invites are group-only, obviously) */}
          {onOpenInviteLinks && (
            <button
              onClick={() => {
                onOpenInviteLinks();
                close();
              }}
            >
              🔗 Invite link
            </button>
          )}
          {/* onLeaveGroup is only passed in for groups */}
          {onLeaveGroup && (
            <button className={confirmingLeave ? "danger confirming" : "danger"} onClick={handleLeaveClick}>
              {confirmingLeave ? "Click again to confirm" : "🚪 Leave group"}
            </button>
          )}
          {/* onBlock is only passed in for DMs — blocking is DM-only (see README) */}
          {onBlock && (
            <button className={confirmingBlock ? "danger confirming" : "danger"} onClick={handleBlockClick}>
              {blockedByMe ? "🔓 Unblock user" : confirmingBlock ? "Click again to confirm" : "🚫 Block user"}
            </button>
          )}
          <button className={confirmingDelete ? "danger confirming" : "danger"} onClick={handleDeleteClick}>
            {confirmingDelete ? "Click again to confirm" : "🗑 Delete conversation"}
          </button>
        </div>
      )}
    </div>
  );
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

// Splits message text on @mentions that the server actually recognized
// (message.mentions — real current group members only) and wraps just
// those in a highlighted span. Deliberately does NOT highlight arbitrary
// "@word" text that wasn't a real mention (e.g. "@" as punctuation, or a
// mention of someone who's since left the group) — only what the backend
// confirmed.
function renderMentionAwareText(content, mentionedUsernames) {
  if (!mentionedUsernames || mentionedUsernames.length === 0) return content;
  const lowerSet = new Set(mentionedUsernames.map((u) => u.toLowerCase()));
  const parts = content.split(/(@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) => {
    const handle = part.startsWith("@") ? part.slice(1).toLowerCase() : null;
    if (handle && lowerSet.has(handle)) {
      return (
        <span key={i} className="mention-highlight">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function MessageContent({ message, mine, myUsername }) {
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

  const iWasMentioned = myUsername && message.mentions?.some((u) => u.toLowerCase() === myUsername.toLowerCase());

  return (
    <div className={`bubble ${mine ? "mine" : ""} ${iWasMentioned ? "mentions-me" : ""}`}>
      {forwardedLabel}
      {replyPreview}
      {renderMentionAwareText(message.content, message.mentions)}
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
