# AniChat — Milestone 19: Mute a Chat

First item tackled from the "Chat-level features" section. Mute is a
per-user, per-chat preference — muting a DM or group only affects your own
view of it, nobody else's — with an optional auto-expiring duration.

## What's new

Every DM and group now has a 🔔/🔕 button in its header, next to the search
icon. Click it and pick **8 hours**, **1 week**, or **Always**. Once muted,
the button turns into a 🔕 you can click to unmute at any time, and hovering
it shows exactly when the mute expires (or "Muted" if it's indefinite).

Muted chats also show a 🔕 next to their name in the inbox list, and their
unread badge switches from the normal accent color to a muted grey — the
count is still shown (you don't lose that information), it's just visually
quieter.

Duration-based mutes actually expire on their own — no need to remember to
unmute something you muted "for 8 hours." I verified this with a real
36-second mute and confirmed it silently dropped off after the wait, not
just that the logic looked right on paper.

## An honest scope note

**There's no active notification system in AniChat yet** — no sound, no
browser push, no in-app toast. Mute has nothing to actually *silence* right
now, because nothing makes noise yet. What this milestone built is real:
a persisted, auto-expiring, per-user mute preference with working UI in
both the chat header and the inbox list — and it's the natural foundation
for browser push notifications (still on the roadmap, unbuilt) to check
before deciding whether to notify someone. I didn't want to quietly build a
button that looks like it does more than it does, so: right now, muting a
chat changes how it *looks*, not (yet) whether you'd hear about a new
message some other way, because no other way exists yet.

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

The migration adds one new table (`chat_mutes`). Nothing existing changes.

## How I tested the backend

Spun up a real Postgres instance and a live server (not just read through
the code), then exercised it end to end:

- Muted a DM forever, confirmed it shows `muted: true` on both the
  conversation-detail endpoint *and* the conversations list
- Unmuted it, confirmed both endpoints flip back
- Muted for a short duration, waited it out for real, confirmed it
  auto-expired and both endpoints reflect that without any manual cleanup
  step on my part
- Confirmed you can't mute yourself, and muting a nonexistent username 404s
- Muted a group as one member and confirmed a *different* member's view of
  that same group is unaffected — mute is genuinely per-user, not group-wide
- Confirmed a non-member gets a 403 trying to mute a group they're not in

**What I couldn't test myself:** the actual button/popover feel in a real
browser — does the duration popover position sensibly, does the 🔕 icon
read clearly at inbox-row size, does the grey badge feel like "quieter"
rather than "broken." That part is on you.

## How to test it yourself

1. Open a DM, click 🔔 in the header, pick "Mute 8 hours"
2. Confirm the button becomes 🔕, and hovering it shows the expiry time
3. Check the inbox — that conversation should now show a 🔕 next to its name
4. Send yourself an unread message from another account, confirm the badge
   shows in grey instead of the normal accent color
5. Click 🔕 to unmute, confirm it goes back to 🔔 and the badge goes back to
   its normal color
6. Try the same in a group, and confirm muting it doesn't affect what other
   members of that group see

## What's intentionally *not* here yet

- No actual notification suppression (see the scope note above — there's
  nothing to suppress yet)
- No "mute all" bulk action
- No custom duration picker — just the three presets (8h / 1 week / always)

## If something goes wrong

- **Mute button does nothing** → check the backend terminal for the exact
  error; also confirm the migration ran (`chat_mutes` table needs to exist)
- **Badge doesn't turn grey** → hard-refresh; the inbox list only re-fetches
  on certain socket events, so a stale mute state can linger until the next
  natural refresh
- Anything else → same as always, exact error text (or what you see) gets
  you a fast fix
