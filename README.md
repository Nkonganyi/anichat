# AniChat — Milestone 12: Reply, Reactions & Promote-to-Admin

Three items from the spec, all landing together since they touch the same
message-actions menu.

## Reply / quote

Click **⋯** → **Reply** on any message. A strip appears above the composer
showing what you're replying to — send your message and the quote travels
with it, shown as a small preview above your message. Works in both DMs
and groups. If the quoted message gets deleted later, the quote preview
gracefully shows "message was deleted" instead of breaking.

## Reactions

Click **⋯** → **React**, or tap directly on an existing reaction pill to
toggle your own. Six reactions: 👍 ❤️ 😂 😮 😢 🙏. Clicking a reaction you've
already left removes it — same toggle behavior as most chat apps. Updates
live for everyone.

One thing I caught and fixed *before* shipping this: my first pass
broadcast a single shared "did I react?" flag to everyone in a
conversation, which is wrong — that flag means something different for
each person looking at it. Fixed by sending the actual list of who
reacted, and having each person's own app figure out "was I one of them?"
for themselves.

## Promote / demote to admin (the real fix, not just a button)

This turned out to be a bigger gap than expected. Checking the actual
code: there was never an API endpoint to change anyone's role after a
group was created — "admin" was a role that existed in the database but
had no way to actually reach it. Not just a missing button; the
capability itself didn't exist.

Now: the group owner can click the small ⬆️/⬇️ next to any member's name
to promote them to admin or demote them back to a regular member. A
system message announces it — in your theme's voice, same as
kicks/adds — and the person's new permissions take effect immediately
(a freshly-promoted admin can add/kick members right away, no
reconnect needed).

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

The migration adds a `reply_to_id` column to both message tables and a
new `message_reactions` table. Nothing existing changes.

## How to test it

1. Reply to a message, confirm the quote preview shows correctly for both
   people, live
2. Delete the original message you replied to (for everyone) — confirm
   the quote preview updates to show it was deleted, not broken text
3. React to a message from two different accounts — confirm the count
   goes to 2, and each account only sees *their own* reaction highlighted,
   not both
4. Click a reaction you already left — confirm it toggles off
5. As a group owner, promote a member to admin — confirm the system
   message appears, and that member can now actually kick/add people
6. Demote them back — confirm they lose those powers immediately
7. Try promoting as a non-owner (even an existing admin) — should be
   blocked; only the owner can change roles

## What's intentionally *not* here yet

- No "jump to original message" when tapping a reply preview — it shows
  the quote, but doesn't scroll you to it yet
- No reaction picker beyond the fixed set of 6 — matches most chat apps'
  "quick reactions" pattern rather than a full emoji keyboard
- No ownership transfer — the owner role itself still can't be reassigned,
  only admin/member

## If something goes wrong

- **Reply preview shows "[media]"** → that's expected for replies to
  stickers/GIFs, which don't have text content to preview
- **Promote/demote buttons don't appear** → only the group owner sees
  them, not other admins — that's intentional
- Anything else → same as always, exact error text gets you a fast fix
