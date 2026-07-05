# BharatTruck — Team Git Workflow (worktree isolation + CTO-only push)

> Authored by the `cto` node, 2026-07-04, after the first-wave reports arrived **tangled** because all
> nodes were sharing one working tree. This is now the mandatory workflow. It is enforced strictly.

## Why this exists (the incident)

All three sessions were running in **one git working copy**. Result: backend's lifecycle commit landed on
the wrong branch and frontend's commit stacked on top of it — `feat/lifecycle-close` ended up empty and
`feat/app-builds-green` contained both tasks. A naïve merge would have silently lost an entire task's work.
Root cause: **no per-agent isolation.** Fixed below.

## The layout — one isolated worktree per node

Each node has its **own working directory** backed by the **same shared repo/history**. Branches cannot
collide because a branch is checked out in exactly one worktree.

| Node | Working directory (do ALL your work here — use the absolute path) | Branch |
|---|---|---|
| `cto` | `/Users/adityaroshanjoshi/Desktop/VS_Code/StartUps/WIP` | `feat/cto-infra-and-governance` |
| `backend` | `/Users/adityaroshanjoshi/Desktop/VS_Code/StartUps/bt-wt-backend` | `feat/lifecycle-close` |
| `frontend` | `/Users/adityaroshanjoshi/Desktop/VS_Code/StartUps/bt-wt-frontend` | `feat/app-builds-green` |

## Rules (strict)

1. **Work only inside your own worktree directory.** `cd` into it at the start of your session and stay
   there. Never run git commands in another node's worktree or in the main repo dir.
2. **One node, one branch, one worktree.** For a new task, the CTO creates you a fresh worktree + `feat/*`
   branch and tells you the path. You do not create branches in a shared dir.
3. **Commit freely inside your worktree.** That's safe now — your commits land on your branch only.
4. **🚫 NEVER push or merge to `main`. This is the single strictest rule on the team.**
   - Engineers do **not** run `git push`, `git merge`, `git push origin main`, or anything that writes to
     `main` or to `origin`. Not once. Not "just this small fix."
   - You finish a task → you **report to `cto`** with your branch + evidence. That's the end of your git
     involvement for that task.
5. **Only the `cto` node pushes — and only after it has checked the work.** "Checked" means the CTO has
   independently: read the diff, run the build, run the tests, and exercised the flow end-to-end against the
   accept-criteria. Only then does the CTO merge your `feat/*` into `main` and push. **The CTO is the sole
   integration/push authority and is personally answerable to the founder for everything that reaches
   `main`.** (See `docs/CTO_ENGINEERING_STANDARDS.md §2–§3`.)
6. **If you think something must reach `main`, you ask the CTO — you never do it yourself.** Bypassing this
   rule is a fireable breach of trust, because it puts unverified code in front of the founder under the
   CTO's name.

## Quick reference (engineer)

```
cd <your worktree path>          # e.g. /Users/.../StartUps/bt-wt-backend
# ... make changes, build, test ...
git add -A && git commit -m "..."   # commits to YOUR feat/* branch — fine
# DO NOT: git push / git merge / touch main
# → send a `report` to cto with branch + verification evidence. CTO takes it from there.
```

_Change this workflow only by CTO decision, appended here with a date._
