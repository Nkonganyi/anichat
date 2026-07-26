import { useCallback, useEffect, useRef, useState } from "react";
import {
  BACKEND_URL,
  getServerTime,
  uploadGroupTrack,
  listGroupTracks,
  deleteGroupTrack,
  getPlaybackState,
  playTrack,
  pausePlayback,
  stopPlayback,
} from "./api";
import { getVoice } from "./voices";

const DRIFT_SOFT_THRESHOLD_MS = 300; // ignore drift smaller than this
const DRIFT_HARD_THRESHOLD_MS = 2000; // beyond this, snap instead of nudging
const NUDGE_FAST = 1.07; // gentle catch-up rate when behind
const NUDGE_SLOW = 0.93; // gentle slow-down rate when ahead

function computeTargetMs(state, clockOffsetMs) {
  if (!state || !state.track) return 0;
  if (state.status === "playing" && state.serverStartedAt) {
    const nowServerTime = Date.now() + clockOffsetMs;
    return state.positionMsBase + Math.max(0, nowServerTime - state.serverStartedAt);
  }
  return state.positionMsBase;
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ListenTogether({ token, groupId, socket, isAdmin, myTheme }) {
  const [state, setState] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [_tick, setTick] = useState(0); // forces re-render every second to update the displayed clock

  const fileInputRef = useRef(null);
  const audioRef = useRef(null);
  const stateRef = useRef(null);
  const clockOffsetRef = useRef(0);

  // ---- calibrate clock offset against the server (median of 3 samples, picking lowest round-trip) ----
  useEffect(() => {
    let cancelled = false;
    async function calibrate() {
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        try {
          const data = await getServerTime();
          const t1 = Date.now();
          const rtt = t1 - t0;
          samples.push({ offset: data.serverTime + rtt / 2 - t1, rtt });
        } catch {
          // ignore a failed sample, we still have others
        }
      }
      if (cancelled || samples.length === 0) return;
      samples.sort((a, b) => a.rtt - b.rtt);
      clockOffsetRef.current = samples[0].offset;
    }
    calibrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshTracks = useCallback(async () => {
    try {
      const data = await listGroupTracks(token, groupId);
      setTracks(data.tracks);
    } catch (err) {
      setError(err.message);
    }
  }, [token, groupId]);

  useEffect(() => {
    let cancelled = false;
    getPlaybackState(token, groupId)
      .then((s) => {
        if (!cancelled) {
          setState(s);
          stateRef.current = s;
        }
      })
      .catch((err) => setError(err.message));
    refreshTracks();
    return () => {
      cancelled = true;
    };
  }, [token, groupId, refreshTracks]);

  useEffect(() => {
    if (!socket) return;
    function handleUpdate(s) {
      if (s.groupId !== groupId) return;
      setState(s);
      stateRef.current = s;
    }
    socket.on("playback:update", handleUpdate);
    return () => socket.off("playback:update", handleUpdate);
  }, [socket, groupId]);

  // ---- keep the audio element in sync with server state ----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state || !joined) return;

    const trackUrl = state.track ? `${BACKEND_URL}/uploads/${state.track.filePath}` : null;

    if (!trackUrl) {
      audio.pause();
      audio.removeAttribute("src");
      audio.dataset.trackUrl = "";
      return;
    }

    if (audio.dataset.trackUrl !== trackUrl) {
      audio.dataset.trackUrl = trackUrl;
      audio.src = trackUrl;
      audio.load();
      const onLoaded = () => {
        audio.currentTime = computeTargetMs(state, clockOffsetRef.current) / 1000;
        if (state.status === "playing") audio.play().catch(() => {});
        audio.removeEventListener("loadedmetadata", onLoaded);
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      return;
    }

    const targetSec = computeTargetMs(state, clockOffsetRef.current) / 1000;
    if (Math.abs(audio.currentTime - targetSec) > 0.5) {
      audio.currentTime = targetSec;
    }
    if (state.status === "playing") {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [state, joined]);

  // ---- continuous drift correction while playing: gentle speed nudges, hard snap only if far off ----
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      const audio = audioRef.current;
      const s = stateRef.current;
      setTick((t) => t + 1);
      if (!audio || !s || s.status !== "playing" || !s.track) {
        if (audio) audio.playbackRate = 1;
        return;
      }
      const targetMs = computeTargetMs(s, clockOffsetRef.current);
      const diff = targetMs - audio.currentTime * 1000; // positive = we're behind

      if (Math.abs(diff) < DRIFT_SOFT_THRESHOLD_MS) {
        audio.playbackRate = 1;
      } else if (Math.abs(diff) < DRIFT_HARD_THRESHOLD_MS) {
        audio.playbackRate = diff > 0 ? NUDGE_FAST : NUDGE_SLOW;
      } else {
        audio.currentTime = targetMs / 1000;
        audio.playbackRate = 1;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [joined]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  async function handleJoin() {
    setJoined(true);
    const audio = audioRef.current;
    if (audio && state?.track) {
      const trackUrl = `${BACKEND_URL}/uploads/${state.track.filePath}`;
      if (audio.dataset.trackUrl !== trackUrl) {
        audio.dataset.trackUrl = trackUrl;
        audio.src = trackUrl;
      }
      audio.currentTime = computeTargetMs(state, clockOffsetRef.current) / 1000;
      if (state.status === "playing") {
        try {
          await audio.play();
        } catch {
          setError("Couldn't start audio automatically — try the join button again.");
        }
      }
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("choose an audio file first");
      return;
    }
    setUploading(true);
    setError("");
    try {
      await uploadGroupTrack(token, groupId, file, uploadTitle.trim() || file.name);
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      refreshTracks();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handlePlay(trackId) {
    try {
      await playTrack(token, groupId, trackId, 0);
    } catch (err) {
      setError(err.message);
    }
  }
  async function handlePause() {
    try {
      await pausePlayback(token, groupId);
    } catch (err) {
      setError(err.message);
    }
  }
  async function handleResume() {
    if (!state?.track) return;
    try {
      await playTrack(token, groupId, state.track.id, state.positionMsBase);
    } catch (err) {
      setError(err.message);
    }
  }
  async function handleStop() {
    try {
      await stopPlayback(token, groupId);
    } catch (err) {
      setError(err.message);
    }
  }
  async function handleDeleteTrack(trackId) {
    try {
      await deleteGroupTrack(token, groupId, trackId);
      refreshTracks();
    } catch (err) {
      setError(err.message);
    }
  }

  const isPlaying = state?.status === "playing";
  const isPaused = state?.status === "paused";
  const displayPositionMs = joined && audioRef.current ? audioRef.current.currentTime * 1000 : computeTargetMs(state, clockOffsetRef.current);

  return (
    <div className="listen-together">
      <audio ref={audioRef} style={{ display: "none" }} />

      <div className="lt-header">
        <span>🎧 Listen Together</span>
        {state?.track && (
          <button className="lt-mute-btn" onClick={() => setMuted((m) => !m)} title={muted ? "Unmute" : "Mute"}>
            {muted ? "🔇" : "🔊"}
          </button>
        )}
      </div>

      {error && <p className="error-text small-text">{error}</p>}

      {state?.track ? (
        <div className="lt-now-playing">
          <div className={`lt-wave ${isPlaying ? "playing" : ""}`}>
            <span /><span /><span /><span />
          </div>
          <div className="lt-track-info">
            <div className="lt-track-title">{state.track.title}</div>
            <div className="lt-track-time">
              {formatTime(displayPositionMs)} {isPaused && "· paused"}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted small-text">Nothing playing right now.</p>
      )}

      {!joined && (
        <button className="primary-btn small" onClick={handleJoin}>
          {getVoice(myTheme).joinListening}
        </button>
      )}

      {isAdmin && (
        <>
          {state?.track && (
            <div className="lt-controls">
              {isPlaying && <button className="toolbar-btn" onClick={handlePause}>⏸ Pause</button>}
              {isPaused && <button className="toolbar-btn" onClick={handleResume}>▶️ Resume</button>}
              <button className="toolbar-btn" onClick={handleStop}>⏹ Stop</button>
            </div>
          )}

          <form className="upload-form" onSubmit={handleUpload}>
            <input type="file" accept="audio/*" ref={fileInputRef} />
            <input
              placeholder="track title (optional)…"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
            />
            <button className="primary-btn small" type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Add track"}
            </button>
          </form>

          {tracks.length > 0 && (
            <div className="lt-track-list">
              {tracks.map((t) => (
                <div key={t.id} className="lt-track-item">
                  <span>{t.title}</span>
                  <span className="lt-track-actions">
                    <button className="post-action-btn" onClick={() => handlePlay(t.id)}>▶️</button>
                    <button className="post-action-btn danger" onClick={() => handleDeleteTrack(t.id)}>🗑️</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
