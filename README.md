# AniChat — Milestone 14: Voice Messages

First item from the "Voice & rich media" section of the spec, built and
tested on its own as requested.

## What's new

Click the 🎤 button in any DM or group composer. It starts recording
immediately (your browser will ask for microphone permission the first
time) — you'll see a pulsing red dot and a live timer. Hit **Send** to
finish and send it, or **Cancel** to throw it away. Recordings auto-stop
at 3 minutes as a sane ceiling.

Recorded messages show up as a proper voice player bubble — play/pause
button, a decorative waveform, and the duration — not just a raw file
link. Works identically for both the sender and recipient's playback.

Because voice messages are just another message type under the hood, they
automatically got everything already built for other messages, with zero
extra work: reactions, replies, delivery ticks, read receipts, pin, star,
forward, delete. I specifically tested that reactions work on a voice
message to confirm this "generic system" assumption actually held up in
practice, not just in theory.

## Nothing new to set up

Same database, same `.env`. Just the usual:

```
cd backend
npm install
npm run migrate
npm start
```

```
cd frontend
npm install
npm run dev
```

The migration adds one column (`voice_duration_seconds`) to both message
tables. Nothing existing changes.

## How I tested the backend (no browser available on my end)

I couldn't record real audio through an actual microphone from my
sandbox, obviously — but I could and did generate real, valid Opus audio
files with ffmpeg and upload them through the exact same code path a
browser would use (`FormData` + `fetch`, not a fake shortcut). Then I
downloaded the file back through the server and verified with `ffprobe`
that what came back is genuinely valid, correctly-timed audio — not just
bytes that happened to save. I also confirmed: non-audio files get
rejected, oversized files get rejected (8MB cap), voice messages can be
replies, and non-members can't send voice messages into a group they're
not in.

**What I couldn't test myself:** the actual in-browser recording
experience — permission prompts, what your specific browser's
MediaRecorder produces, whether playback feels smooth. That's the part
that needs your real test.

## How to test it yourself

1. Click 🎤 in a DM, say something, hit Send
2. Confirm it appears as a playable voice bubble for you, and — open a
   second window — for the other person too, live
3. Play it back — confirms the waveform progress and duration display
   update as it plays
4. Try Cancel mid-recording — confirms nothing gets sent
5. Try reacting to a voice message, or replying to one — confirms those
   generic features really do "just work"
6. Try it in a group too

## What's intentionally *not* here yet

- No hold-to-record (press and hold a button, release to send) — this is
  tap-to-start, tap-to-send, which is more reliable across mouse vs.
  touch input and doesn't risk losing a recording if your finger slips
- Waveform is decorative/stylized, not a literal amplitude visualization
  of the actual audio — matches what most chat apps actually do, real
  waveform analysis is a lot of extra complexity for limited payoff
- No transcription

## If something goes wrong

- **🎤 button does nothing, or shows a permission error** → check your
  browser's microphone permission for this site (usually a padlock/icon
  in the address bar)
- **Recording works but sending fails** → check the backend terminal for
  the exact error
- Anything else → same as always, exact error text (or what you see/hear)
  gets you a fast fix
