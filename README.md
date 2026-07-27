# AniChat — Milestone 13: Forward, Pin, Star & More

This closes out every remaining item from the "message-level features"
section of the messaging spec. Six features, all landing together.

## Forward a message

**⋯ → Forward** on any message opens a small picker: type a username, or
pick from your groups. The forwarded copy is a real new message (you can
edit/delete it independently), tagged with **"↪ Forwarded from
[original sender]"**. Works in all four directions — DM→DM, DM→group,
group→DM, group→group.

## Pinned messages

**⋯ → Pin** on any message. Pinned messages show in a compact bar at the
top of the chat, above the scrolling history — so they're always visible,
not buried in scroll history.
- **DMs:** either participant can pin/unpin — it's a shared conversation
- **Groups:** admin/owner only, since it's more of a "this matters for
  everyone" moderation signal there

## Starred / saved messages

**⋯ → Star** bookmarks a message privately — nobody else can see what
you've starred. There's a new **⭐ tab** showing everything you've
starred across every DM and group at once, with a "Go to conversation"
link that jumps you straight there.

## Resend on failure

If sending a message fails (network hiccup, server blip), it no longer
just vanishes with an error banner. It shows up in a small "⚠️ Failed to
send" strip with **Retry** and **✕ discard** — so a bad connection
doesn't cost you a message you already typed.

## In-chat search

Click 🔍 next to a conversation's name to filter the visible messages
down to ones matching your search — works in both DMs and groups. This
is a client-side filter over what's already loaded (we don't have
message pagination yet — see the note below).

## Draft persistence

Type a message, switch to a different conversation (or a different tab
entirely) without sending, come back later — your unsent text is still
there. Saved locally per-conversation, cleared automatically once you
actually send.

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

The migration adds `forwarded_from_username` and `pinned_at` to both
message tables, plus a new `starred_messages` table. Nothing existing
changes.

## How to test it

1. Forward a message to a DM, then to a group — confirm the "Forwarded
   from" tag appears correctly both times
2. Pin a message in a DM as either participant — confirm it shows in the
   bar for both people, live
3. Try pinning in a group as a regular (non-admin) member — should be
   blocked; try as the owner — should work
4. Star a few messages across different conversations, check the ⭐ tab
   shows all of them with correct context, and that "Go to conversation"
   actually navigates there
5. Turn off your network briefly and try sending a message — confirm you
   get the retry strip instead of losing the text, then turn network back
   on and hit Retry
6. Type a search term in an active conversation — confirm the message
   list filters down to matches
7. Start typing a message, switch tabs without sending, come back —
   confirm your draft is still in the box

## A note on search & scale

In-chat search right now works by filtering messages already loaded in
your browser — which is completely fine at the message volumes we're at,
but it's worth knowing this wouldn't scale gracefully to a conversation
with tens of thousands of messages, since we load full history per
conversation rather than paginating. Message pagination is still on the
broader roadmap as its own item; once that lands, search would need to
move server-side to search across everything, not just what's currently
loaded.

## What's intentionally *not* here yet

- No forward-to-multiple-recipients-at-once — one destination per forward
  action, same as most chat apps' basic flow
- No "forwarded 5 times" chain tracking — each forward just remembers its
  immediate original sender, not a full chain of hops
- Resend-on-failure doesn't yet queue messages while fully offline and
  auto-send when reconnected — it's a manual retry, not automatic

## If something goes wrong

- **Pin/unpin button doesn't appear in a group** → only admins/owners see
  it there, by design
- **Starred tab is empty but you know you starred something** → check
  you're on the right account; starring is private per-user
- Anything else → same as always, exact error text gets you a fast fix
