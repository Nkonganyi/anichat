# AniChat — Milestone 20: Archive / Delete a Conversation

Second and third items from the "Chat-level features" list, done together
since they're both "clear a chat out of your own view" actions and share a
lot of plumbing. Both are per-user — one person archiving or deleting a
chat never affects what anyone else sees.

## What's new

**Archive** — a 🔔/📥-style toggle now lives in the chat-options menu (⋮,
next to the mute button) in both DM and group headers. Archiving pulls a
chat out of your main inbox list without touching anything else — no
messages are deleted, nothing changes for the other person, and your
unread count for that chat keeps working normally. The inbox now has a
**Chats / 📥 Archived** switch at the top so you can browse (and unarchive)
whatever you've tucked away.

One deliberate design call worth flagging: **archiving is manual and
sticky — a new incoming message does NOT automatically pull a chat back
out of Archived.** I considered auto-unarchiving on new activity (that's
what a lot of chat apps do), but AniChat still has no notification system
of any kind, so there's no "you might miss something" risk that auto-
unarchiving would be protecting against — an archived chat's unread count
still increments normally, you just see it when you check Archived instead
of Chats. Keeping it manual also meant not having to thread an unarchive
call through every single message-send endpoint (there are a lot of them —
text, stickers, voice, video notes, files, images…). If this stops feeling
right once real notifications exist, it's a one-place change.

**Delete conversation** — also in the ⋮ menu, below Archive. Since this
one's irreversible, it doesn't fire on the first click: clicking arms a
"Click again to confirm" state for a few seconds, then fires on the second
click (no jarring browser `confirm()` popup, consistent with the rest of
the custom UI here). It clears your view of that conversation's history —
**only yours**. The other person (or other group members) keep every
message exactly as it was.

If you delete a DM and later get a new message from that person, only the
new message shows — old history stays hidden. Same idea for groups, except
a group never disappears from your list entirely (you're still a member of
it), it just shows no message preview until something new comes in.

## Nothing new to set up

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

Migration adds two tables (`chat_archives`, `chat_clears`). Nothing
existing changes.

## How I tested this

Same approach as the last few milestones — a real Postgres instance and a
live server, not just reading through the code:

- Archived a DM → confirmed it vanished from the default `/api/conversations`
  list, showed up under `?archived=true`, and the DM header reflected it
- Unarchived it → confirmed everything flipped back
- **The big one:** alice deleted her conversation with bob. Confirmed her
  message count dropped to 0 and bob disappeared from her inbox — then
  confirmed **bob's own view was completely unaffected** (still all 6
  messages, still in his inbox). Then had bob send a new message and
  confirmed alice saw *exactly* that one message (not the old history),
  and bob reappeared in her inbox automatically — all without writing any
  special "just arrived" logic; it fell straight out of the timestamp-
  cutoff design.
- Group version of the same test: bob cleared the group's history for
  himself, carol's view of the same group was untouched, and the group
  correctly stayed in bob's list (empty preview) rather than disappearing
- Non-members correctly get a 403 trying to archive or clear a group they
  aren't in
- Full frontend build passes clean

**What I couldn't test myself:** the actual ⋮ menu in a browser — does the
popover position well against both header layouts, does the "click again
to confirm" state read clearly, does the Chats/Archived toggle feel snappy
switching back and forth. Worth a manual pass.

## How to test it yourself

1. Open a DM, click ⋮ → Archive chat. Check the inbox — it should be gone
   from Chats and show up under Archived
2. From the Archived tab, click the 📤 next to it to unarchive — it should
   come back to Chats
3. Open a DM, click ⋮ → Delete conversation once (button should change to
   "Click again to confirm"), then click it again — the thread should
   clear and you'll land back on the "no chat open" screen
4. Have the other account message you again — you should only see that new
   message, not the old history
5. Try the same delete flow inside a group — this time the group should
   stay visible in your list (just with an empty preview) rather than
   disappearing, since you're still a member

## What's intentionally *not* here yet

- No auto-unarchive on new messages (see the design note above)
- No "restore deleted conversation" — delete is one-way by design
- No bulk archive/delete across multiple chats at once

## If something goes wrong

- **Archive/delete does nothing** → check the backend terminal; also
  confirm the migration ran (`chat_archives` and `chat_clears` need to exist)
- **Deleted conversation still shows old messages** → hard refresh; if it
  persists, check the backend log for a query error
- Anything else → same as always, the exact error text gets you a fast fix
