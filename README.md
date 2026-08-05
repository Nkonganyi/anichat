# AniChat — Milestone 26: Leave Group

Fifth item from "Group improvements." Members could previously only be
removed by an admin/owner (kicked) — now anyone can voluntarily leave a
group themselves.

## What's new

⋮ menu → 🚪 Leave group, same two-step "click again to confirm" pattern as
Delete conversation and Block user. Leaving:

- Removes you from the group immediately
- Drops a system message ("bob left the group") for everyone still there,
  live over the socket — same convention as every other membership event
- Removes the group from your own sidebar and inbox

**The owner is a special case.** As owner, you can't leave while anyone
else is still in the group — you'd be abandoning something you're
responsible for with no one designated to take over. The one exception:
if you're the **last** person left in the group, leaving deletes the whole
group. There's nothing left to own at that point, so "leave" and "delete"
collapse into the same action.

This is a deliberate, temporary limitation, not an oversight: the *real*
answer for an owner who wants out while others remain is **transfer
ownership first** — which is next on the roadmap, not yet built. Until
then, an owner's only paths out of a group with other people still in it
are transferring ownership (once that exists) or removing everyone else
first via kick. I didn't want to build a half-answer here (like
auto-promoting a random admin) when the real feature for this is coming
right after.

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

No schema changes this time — leaving just deletes existing rows
(`group_members`, and for the last-member case, the group itself). One
cleanup detail: `chat_mutes`, `chat_archives`, and `chat_clears` don't have
a direct foreign key to `groups` (they're polymorphic across DM/group), so
when a group gets fully deleted, those get an explicit cleanup sweep in the
same request rather than being silently orphaned.

## How I tested this

Real Postgres, live server, real HTTP requests:

- A regular member left a group with others still in it — confirmed they
  were removed, a system message landed, and the group still exists fine
  for everyone else
- Confirmed the leaving member's own subsequent request to that group
  correctly 403s ("not a member") — they're really out, not just hidden
  from their own view
- Confirmed an owner trying to leave *while others remain* gets a clear
  403 with an explanation, not a silent no-op or a confusing error
- Confirmed that once the owner is the *only* member left, leaving
  succeeds and **actually deletes the group** — verified directly against
  the database that `group_members`, `group_messages`, and the `groups`
  row itself were all gone afterward, not just hidden
- Ran the full owner-blocked → other-member-leaves → owner-now-alone →
  owner-leaves-and-group-deletes sequence end to end in one flow, not just
  each case in isolation
- Re-ran the core scenario again on a fresh server boot of the finished code
- Full frontend build passes clean

**What I couldn't test myself:** the actual ⋮ menu interaction in a
browser, and specifically what it feels like to be a *different*, still-
present member watching someone leave live (does the system message and
member-list update land smoothly without a flicker or a stale roster).
Worth a manual pass with two accounts open side by side.

## How to test it yourself

1. In a group where you're a regular member (not owner), click ⋮ → 🚪
   Leave group (click twice to confirm)
2. You should be dropped back to the inbox, and that group should no
   longer be in your sidebar
3. From another account still in that group, confirm you see a system
   message and the member list update live
4. As the owner of a group with other members, try to leave — you should
   get a clear explanation of why you can't yet
5. Remove/have everyone else leave until you're the only one left, then
   leave yourself — the group should be gone entirely, not just empty

## What's intentionally *not* here yet

- No ownership transfer (the real fix for "owner wants to leave but others
  remain") — that's the next milestone
- No "leave and delete all my messages" combo — leaving doesn't touch
  your message history, same as kicking doesn't either
- No confirmation dialog beyond the two-click pattern (no "are you sure"
  modal with additional warnings)

## If something goes wrong

- **Leave button does nothing** → check the backend terminal for the
  actual error
- **Owner can't leave even when alone** → double check via the group's
  member list that you're genuinely the only one — a stale cached member
  list client-side could make it look that way when you're not
- Anything else → same as always, exact error text gets you a fast fix
