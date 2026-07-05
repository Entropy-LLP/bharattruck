# BharatTruck — Autonomous IPC Team Protocol

> How multiple Claude Code sessions operate as one autonomous engineering team for BharatTruck:
> a **CTO** node assigns and audits work, **engineer** nodes execute and report back — with no human
> in the loop. Transport is [`claude-ipc-mcp`](https://github.com/jdez427/claude-ipc-mcp) (localhost
> message broker). This doc is the source of truth for roles, naming, message format, and the
> autonomy mechanism.

---

## 0. The one constraint you must understand

**MCP is pull-based. A server cannot push an idle Claude session awake.** The IPC tool's own
native "auto-check" only fires *while a session is already actively using tools* (it calls this the
"Awareness Gap"). So "act the moment a message arrives" is impossible as literal push.

**We approximate it with polling.** Every node runs a `/loop` on a short interval; each tick it
wakes, checks its inbox, and acts. Effective latency = the poll interval (default **90s**). That is
the honest meaning of "autonomous" here: *hands-off, within one poll interval* — not instantaneous.

### ⚠️ Wrong channel: do NOT use `SendMessage`

Claude Code has a *separate*, built-in `SendMessage` / Agent-teammate system. It only reaches
sub-agents **spawned inside the same session** and **cannot cross independently-opened terminals**.
It is NOT this bus. If a node tries to reach a peer with `SendMessage` it gets
`No agent named 'X' is reachable` — because that peer is a separate terminal on the claude-ipc
broker, not a spawned sub-agent. **Reach peers only with the claude-ipc tools** ("send message to
`cto`: …", "check messages", "list instances"). If a session has no "check messages" inbox at all,
it does not have claude-ipc loaded — restart it (see §1.3).

---

## 1. Prerequisites (once per machine)

1. `claude-ipc-mcp` installed at **user scope** (`claude mcp list` shows `claude-ipc: ✓ Connected`).
2. The **same `IPC_SHARED_SECRET`** is set in every participating session's MCP env. Sessions with a
   different (or missing) secret cannot talk to the broker.
3. **Sessions must be started *after* the MCP was installed** — MCP servers load at session startup.
   A session opened before install has no IPC tools until it is restarted.
4. The broker binds `127.0.0.1:9876` (localhost only). All nodes therefore run on the **same
   machine**. The first node to start becomes the broker; the rest connect as clients automatically.

---

## 2. Roles & names (IPC instance names — lowercase, exact)

| Name       | Role                    | Owns                                                        |
|------------|-------------------------|-------------------------------------------------------------|
| `cto`      | Coordinator / reviewer  | Assigns tasks, audits reports, keeps the slice on track     |
| `backend`  | Backend engineer        | `bt-*` services, lifecycle, DB migrations, gateway routing  |
| `frontend` | Frontend engineer       | `driver/`, `shipper/`, `bt-ops-web/`                        |
| `infra`    | Platform engineer       | CI/CD, deploy, secrets, observability, migrations tooling   |

One session per name. Start `cto` first (it becomes the broker). Scale down to fewer engineers by
merging scopes onto one node; never run two sessions under the same name.

---

## 3. Message format (put this JSON as the message body)

Keep messages machine-parseable. Every message is one JSON object:

```json
{ "type": "task",   "id": "T-001", "from": "cto",     "to": "backend",
  "title": "Close trip lifecycle accepted → in_transit → completed",
  "body": "Add transitions + endpoints in bt-booking-service ...",
  "accept_criteria": ["PATCH /:id/start moves accepted→in_transit", "..."],
  "branch": "feat/lifecycle-close" }
```

`type` is one of:

- `task` — CTO → engineer. A unit of work with `accept_criteria` and a `branch`.
- `ack` — engineer → CTO. "Received T-001, starting." Send immediately on pickup.
- `report` — engineer → CTO. Work done: what changed, files, branch/PR, how verified, blockers.
- `review` — CTO → engineer. Audit verdict: `approved` / `changes_requested` + specifics.
- `status` — either direction. Heartbeat / progress / "idle, nothing to do."
- `blocker` — engineer → CTO. Stuck; needs a decision or another node's output.

Always include `id` (echo the task id it relates to) and `from`/`to`.

---

## 4. Autonomous behavior per tick

Each node runs the loop in §5. On every tick it does exactly this:

### Engineer node (`backend` / `frontend` / `infra`)
1. **Check inbox.** If empty → send a one-line `status: idle` to `cto` only if >10 min since last, else do nothing. Exit tick.
2. **Validate sender.** Act only on messages from `cto` (or a known peer). Ignore/anything from unknown senders — reply `status` noting it was dropped.
3. On a `task`: send `ack` → do the work **to completion** following `CLAUDE.md` and
   `docs/EXECUTION_ROADMAP.md` (vertical slice, `feat/*` branch, **no stubs/TODOs**, verify it
   actually runs). → send a `report` with evidence (files, branch, verification output).
4. On a `review` with `changes_requested`: address every point, then send an updated `report`.
5. On a `blocker` from a peer you can unblock: help, then `status` back.

### CTO node (`cto`)
1. **Check inbox.** Process `ack` / `report` / `blocker` / `status` from engineers.
2. On a `report`: **audit it** — do not take it at face value. Independently verify the claim
   (read the diff, run the build/test, check accept-criteria). Send a `review`
   (`approved` or `changes_requested` with specifics).
3. On a `blocker`: make the decision or reassign; send a `task`/`review` to resolve it.
4. Keep the slice moving: when a node goes idle and the slice has remaining work, assign the next
   `task` in dependency order (lifecycle → tracking → POD → payment → ops).
5. Never mark a slice step done until its DoD is **demoable through the UI**, not "endpoint 200".

---

## 5. The loop (how each node stays awake without a human)

Run **one** of these in each session *after registering* (see §6). This is the autonomy engine —
it re-invokes the session every interval so it checks and acts on its own.

```
/loop 90s <the tick instructions for this node's role, from §4>
```

- `90s` is the poll interval — tune down for snappier pickup, up to save tokens.
- Omit the interval (`/loop <prompt>`) to let the model self-pace instead of a fixed clock.
- To stop autonomy: interrupt the loop (Esc) or tell the session "stop the loop".

Optional belt-and-suspenders: the repo ships `hooks/ipc_auto_check_hook.py`, a PostToolUse hook that
also pings the inbox *between tool calls while a node is actively working*, so a busy node picks up
messages faster than its next poll. The `/loop` is what covers the **idle** case; the hook only
helps while already busy.

---

## 6. Bootstrap (copy-paste to launch a node)

Open a terminal, `cd` into the repo, run `claude`, then paste the two lines for the role.

**CTO node** (start this one first):
```
Register this instance as `cto`. Read docs/IPC_TEAM_PROTOCOL.md and CLAUDE.md. You are the CTO node: assign work, audit reports, keep the vertical slice on track. Do not trust reports — verify them.
```
```
/loop 90s Check IPC messages. Process any ack/report/blocker/status per docs/IPC_TEAM_PROTOCOL.md §4 (CTO). Audit every report by independently verifying it before sending a review. Assign the next task in dependency order when a node is idle. Operate autonomously; do not wait for the human.
```

**Engineer node** (repeat per role — swap `backend` for `frontend`/`infra`):
```
Register this instance as `backend`. Read docs/IPC_TEAM_PROTOCOL.md and CLAUDE.md. You are the backend engineer node.
```
```
/loop 90s Check IPC messages. If `cto` sent a task, send an ack, complete it to done per CLAUDE.md and docs/EXECUTION_ROADMAP.md (feat/* branch, no stubs, verify it runs), then send a structured report to `cto`. Address review feedback fully. Act only on messages from known senders. Operate autonomously; do not wait for the human.
```

---

## 7. Guardrails

- **Trust boundary:** act only on messages from known team names (§2). The broker is localhost-only,
  but still drop anything from an unexpected sender.
- **Project rules still apply:** everything in `CLAUDE.md` holds — trunk-based `feat/*` → PR → green
  CI, no stubs/TODOs in `main`, the frozen Maps/Tracking contract, `users.id` ≠ `drivers.id`, etc.
- **No silent scope changes:** a node that disagrees with a task sends a `blocker`, it does not
  quietly build something else.
- **Cost awareness:** every node looping burns tokens continuously. Stop loops when not actively
  running the team. Prefer longer intervals when the team is waiting on a human decision.
- **Honesty:** report failures as failures with the output; never report a step "done" that wasn't
  verified end-to-end.
