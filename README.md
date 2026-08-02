# AniChat — Milestone 15: Video Notes

Second item from the "Voice & rich media" section — the Telegram-style
short circular video message, built the same way as voice messages: its
own recording flow, its own player, fully tested on the backend before
any frontend work started.

## What's new

Click the 📹 button next to the mic in any composer. Your browser will ask
for camera *and* microphone permission the first time. You'll see a live
circular preview of yourself (mirrored, like a selfie camera) with a
recording timer. Hit **Send** to finish, or **Cancel** to discard.
Recordings auto-stop at 60 seconds.

Received video notes show up as a round, tap-to-play video bubble with a
duration label — not a generic video file link.

Same as voice messages, this reused the existing generic message
machinery automatically: reactions, replies, delivery ticks, pin, star,
forward, delete all work on a video note with zero extra code, since
under the hood it's just another message type. I specifically tested
reactions on a video note to confirm that held up, not just assumed it.

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

The migration adds one column (`video_duration_seconds`) to both message
tables. Nothing existing changes.

## How I tested the backend

Generated a real short video (VP8 video + Opus audio, matching what a
browser's MediaRecorder actually produces) with ffmpeg, uploaded it
through the exact `FormData`/`fetch` path a browser would use, downloaded
it back through the server, and verified with `ffprobe` that both the
video *and* audio streams survived intact with the correct duration — not
just that bytes made it through. Also confirmed: non-video files get
rejected, oversized files get rejected (20MB cap), video notes can be
replies, and non-members can't send one into a group they're not in.

**What I couldn't test myself:** the actual in-browser camera experience
— permission prompts, live preview quality, whether the recording feels
responsive. That part is on you.

## How to test it yourself

1. Click 📹 in a DM, record a few seconds, hit Send
2. Confirm it shows up as a round, playable video for both you and the
   other person, live
3. Tap it to play/pause — confirm the play icon disappears while playing
4. Try Cancel mid-recording — confirms nothing sends
5. Try reacting to or replying to a video note
6. Try it in a group

## What's intentionally *not* here yet

- No filters/effects on the camera preview
- Fixed 60-second cap, no way to extend it
- No option to switch between front/back camera (defaults to
  front-facing, `facingMode: "user"`) — reasonable for a "video selfie"
  style message, less so if someone wants to quickly show something in
  front of them instead of their own face

## If something goes wrong

- **📹 button does nothing, or shows a permission error** → check your
  browser's camera *and* microphone permissions for this site
- **Recording works but sending fails** → check the backend terminal for
  the exact error, and note the 20MB size cap
- Anything else → same as always, exact error text (or what you see) gets
  you a fast fix
