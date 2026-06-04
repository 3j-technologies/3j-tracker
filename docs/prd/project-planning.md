# PRD: Project Planning Module

**Status:** Implementation in progress  
**Branch:** `feat/project-planning`  
**Author:** 3J Engineering  
**Date:** 2026-06-04

---

## 1. Context & Goal

The 3J Tracker already has Projects (a container for tasks), task board status, comments, labels, assignees, and an activity_log. What it lacks is structured *planning*:

- Internal team timelines vs. customer-committed dates
- Named milestones with customer visibility control
- Dependency tracking and critical-path analysis
- Blocker management
- A read-only customer share link showing ONLY committed milestones (never internal dates, comments, assignees, or buffer margins)

This module adds those capabilities as **additive schema and API**, layering on top of existing tasks without breaking them.

---

## 2. Architecture Learnings

From codebase exploration:

| Layer | Technology |
|---|---|
| HTTP server | Go + chi router (cmd/server/router.go) |
| DB access | sqlc-generated queries (pkg/db/generated/) |
| Schema migrations | Sequential numbered SQL files (server/migrations/) |
| Activity logging | `activity_log` table — `(workspace_id, issue_id, actor_type, actor_id, action, details JSONB, created_at)` |
| Realtime | Redis-backed broadcast via events.Bus |
| CLI | Cobra (cmd/multica/) — hand-written per entity, calls REST |
| No MCP server exists yet in this codebase — the MCP reference is an agent config feature (agent-level), not a standalone server |

**No OpenAPI spec / codegen exists** — CLI commands are hand-written calling the REST API. New CLI commands follow the same pattern.

**Existing tables relevant to this module:**
- `project` — container; has title/status/priority/lead
- `issue` — task; has `project_id`, `status`, `due_date`, `start_date`, `assignee_*`, `priority`
- `issue_dependency` — existing table with `(issue_id, depends_on_issue_id, type)` where type ∈ {blocks, blocked_by, related}
- `activity_log` — audit trail attached to an issue_id

---

## 3. Feature Design

### 3.1 Dual Dates

Every plannable item (issue/task) gains **two date pairs**:

| Field | Meaning | Visible to customer? |
|---|---|---|
| `internal_start` | Team's working target start | NO |
| `internal_due` | Team's working target end (has buffer margin) | NO |
| `committed_start` | Customer-facing start date | YES (if customer_visible) |
| `committed_due` | Customer-facing due date | YES (if customer_visible) |

The existing `due_date` field remains as the canonical "scheduled due" for the board. Internal dates are stored in a separate `issue_plan` table to avoid schema churn on the core `issue` table.

### 3.2 Milestones

Named checkpoints within a project:

- `name`, `description`, `committed_date` (the customer-visible date)
- `internal_date` (team's internal target — never leaked)
- `customer_visible` flag — default FALSE
- Status: `on_track | at_risk | delayed | completed` — computed from linked tasks
- Roll up tasks assigned to this milestone
- At-risk when any blocking task is behind schedule vs. `internal_date`

### 3.3 Dependency Graph

New table `task_dependency` (supersedes `issue_dependency` for project-planning semantics; `issue_dependency` remains untouched for backward compat):

- `predecessor_id` → `successor_id` (finish-to-start)
- `dep_type`: `finish_to_start` (default), `start_to_start`, `finish_to_finish` (reserved for future)
- `lag_days`: optional buffer/overlap days (positive = delay after predecessor, negative = overlap)
- Cycle detection: reject any edge that creates a cycle (DFS on insert)

**Critical path computation:**
- DAG traversal using longest-path algorithm (ASAP forward pass + ALAP backward pass)
- Returns ordered list of tasks forming the longest dependency chain → project end
- Identifies total float for each task (zero float = on critical path)
- Used for: at-risk rollup, what-if date changes, milestone health

### 3.4 Blockers

First-class, two kinds:

1. **Dependency-derived**: automatically created when a predecessor task is behind schedule relative to the successor's `internal_start`
2. **External**: manual, with `reason TEXT`, `owner TEXT`, `status` ∈ {open, in_progress, resolved}

Table: `plan_blocker`
- `kind`: `dependency | external`
- `issue_id`: the blocked task
- `blocking_issue_id`: for dependency kind
- `reason`, `owner_name`, `status`
- `resolved_at`

### 3.5 Customer Share Link

A `plan_share` row mints a read-only public token:

- `token`: 32-byte random hex (like task_token pattern)
- `project_id`: scoped to one project
- `scope`: `milestones` (only milestones for now; extensible)
- `expires_at`: optional expiry
- `revoked_at`: explicit revocation
- `created_by_type/id`: audit

**PUBLIC endpoint:** `GET /public/plan/:token`

**Allowlist projection (DEFAULT-DENY):**
The response is built by an explicit allowlist:
- ✅ Milestone `name`, `committed_date`, `committed_health`, `customer_visible=true` milestones only
- ✅ Project `title` only
- ❌ NEVER: internal_date, internal_start, internal_due, buffer margin, assignees, comments, task titles, task counts, workspace details, member names, agent details

The projection function `customerProjection()` takes a raw plan and returns a `CustomerPlanView` struct that contains ONLY the allowlisted fields. There is no field exclusion (blacklist) — only explicit field inclusion (allowlist). A code review finding a new field added to `CustomerPlanView` that isn't in the allowlist spec triggers a build error.

### 3.6 Health Rollup

Two health signals computed per project and per milestone:

| Signal | Based on | Logic |
|---|---|---|
| `internal_health` | `internal_due` dates | `on_track` if all tasks ≤ internal_due; `at_risk` if any critical-path task within 20% of time; `delayed` if any task past internal_due |
| `committed_health` | `committed_due` dates | Same logic but vs committed dates |

Milestone health: inherit from the worst task assigned to it on the critical path.

### 3.7 Activity Log Integration

All mutations in the planning module write to the existing `activity_log` table with these `action` values:

| Action | Trigger |
|---|---|
| `plan.dates_changed` | internal or committed dates updated |
| `plan.dependency_added` | dependency edge created |
| `plan.dependency_removed` | dependency edge deleted |
| `plan.milestone_created` | milestone created |
| `plan.milestone_slip` | milestone's committed_date shifted |
| `plan.blocker_added` | blocker created |
| `plan.blocker_resolved` | blocker status → resolved |
| `plan.share_minted` | share token created |
| `plan.share_revoked` | share token revoked/rotated |
| `plan.customer_visible_changed` | customer_visible flag toggled |

### 3.8 Notifications

The existing inbox_item + event bus pattern is reused:

- Milestone at-risk → notify project lead + milestone assignee
- New blocker → notify issue assignee + project lead
- Committed date changed → notify project lead

---

## 4. Data Model

### New Tables

```sql
-- Planning fields per issue (additive, separate table to avoid issue churn)
issue_plan (
  issue_id UUID PK FK issue(id) ON DELETE CASCADE,
  internal_start  TIMESTAMPTZ,
  internal_due    TIMESTAMPTZ,
  committed_start TIMESTAMPTZ,
  committed_due   TIMESTAMPTZ,
  progress        INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  customer_visible BOOLEAN DEFAULT FALSE,
  is_blocked      BOOLEAN DEFAULT FALSE,
  milestone_id    UUID FK plan_milestone(id) ON DELETE SET NULL
)

-- Milestones
plan_milestone (
  id          UUID PK,
  workspace_id UUID FK workspace(id),
  project_id  UUID FK project(id),
  name        TEXT NOT NULL,
  description TEXT,
  internal_date   TIMESTAMPTZ,
  committed_date  TIMESTAMPTZ,
  customer_visible BOOLEAN DEFAULT FALSE,
  status      TEXT DEFAULT 'on_track' CHECK (...),
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
)

-- Task dependencies (project-planning semantics; issue_dependency unchanged)
task_dependency (
  id             UUID PK,
  workspace_id   UUID FK workspace(id),
  predecessor_id UUID FK issue(id) ON DELETE CASCADE,
  successor_id   UUID FK issue(id) ON DELETE CASCADE,
  dep_type       TEXT DEFAULT 'finish_to_start',
  lag_days       INT DEFAULT 0,
  created_at     TIMESTAMPTZ,
  UNIQUE(predecessor_id, successor_id)
)

-- Blockers
plan_blocker (
  id                UUID PK,
  workspace_id      UUID FK workspace(id),
  issue_id          UUID FK issue(id) ON DELETE CASCADE,
  kind              TEXT CHECK ('dependency', 'external'),
  blocking_issue_id UUID FK issue(id) ON DELETE SET NULL,
  reason            TEXT,
  owner_name        TEXT,
  status            TEXT DEFAULT 'open' CHECK ('open','in_progress','resolved'),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ
)

-- Share tokens
plan_share (
  id             UUID PK,
  token          TEXT UNIQUE NOT NULL,  -- 32-byte random hex
  project_id     UUID FK project(id) ON DELETE CASCADE,
  workspace_id   UUID FK workspace(id) ON DELETE CASCADE,
  scope          TEXT DEFAULT 'milestones',
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  created_by_type TEXT,
  created_by_id   UUID,
  created_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ
)
```

---

## 5. REST API

All authenticated routes live under the existing `/api/workspaces/{id}/` prefix. The public endpoint has no auth.

### Issue Plan Dates
```
PUT  /api/workspaces/{wsId}/issues/{issueId}/plan          — set internal/committed dates, progress, customer_visible
GET  /api/workspaces/{wsId}/issues/{issueId}/plan          — get plan fields
```

### Milestones
```
POST   /api/workspaces/{wsId}/projects/{projectId}/milestones
GET    /api/workspaces/{wsId}/projects/{projectId}/milestones
GET    /api/workspaces/{wsId}/projects/{projectId}/milestones/{milestoneId}
PUT    /api/workspaces/{wsId}/projects/{projectId}/milestones/{milestoneId}
DELETE /api/workspaces/{wsId}/projects/{projectId}/milestones/{milestoneId}
```

### Dependencies
```
POST   /api/workspaces/{wsId}/task-dependencies              — create edge
GET    /api/workspaces/{wsId}/projects/{projectId}/dependencies — list all edges for a project
DELETE /api/workspaces/{wsId}/task-dependencies/{depId}       — remove edge
GET    /api/workspaces/{wsId}/projects/{projectId}/dependency-graph — DAG JSON
GET    /api/workspaces/{wsId}/projects/{projectId}/critical-path   — ordered task list
```

### Blockers
```
POST   /api/workspaces/{wsId}/issues/{issueId}/blockers
GET    /api/workspaces/{wsId}/issues/{issueId}/blockers
GET    /api/workspaces/{wsId}/projects/{projectId}/blockers  — all blockers in project
PUT    /api/workspaces/{wsId}/blockers/{blockerId}
DELETE /api/workspaces/{wsId}/blockers/{blockerId}
```

### Health
```
GET    /api/workspaces/{wsId}/projects/{projectId}/health    — project + milestone health rollup
```

### Share Links
```
POST   /api/workspaces/{wsId}/projects/{projectId}/share     — mint token
GET    /api/workspaces/{wsId}/projects/{projectId}/share     — get current share info (no token in body)
POST   /api/workspaces/{wsId}/projects/{projectId}/share/rotate — rotate token
DELETE /api/workspaces/{wsId}/projects/{projectId}/share     — revoke
```

### Public (no auth)
```
GET    /public/plan/{token}   — customer view (allowlist projection only)
```

---

## 6. CLI Commands (Headless Parity)

All CLI calls go through the existing `internal/cli.Client` HTTP wrapper.

```
multica plan dates <issue-id> [--internal-start DATE] [--internal-due DATE] [--committed-start DATE] [--committed-due DATE] [--progress N] [--customer-visible BOOL]
multica plan get <issue-id>

multica milestone create <project-id> --name NAME [--committed-date DATE] [--internal-date DATE] [--customer-visible]
multica milestone list <project-id>
multica milestone get <milestone-id>
multica milestone update <milestone-id> [flags]
multica milestone delete <milestone-id>

multica dep add <predecessor-id> <successor-id> [--lag DAYS]
multica dep list <project-id>
multica dep remove <dep-id>
multica dep graph <project-id>         -- JSON DAG output
multica dep critical-path <project-id> -- ordered task list

multica blocker add <issue-id> [--reason TEXT] [--owner NAME]
multica blocker list <project-id|issue-id>
multica blocker resolve <blocker-id>
multica blocker update <blocker-id> [flags]
multica blocker delete <blocker-id>

multica plan health <project-id>

multica share mint <project-id> [--expires DATETIME]
multica share get <project-id>
multica share rotate <project-id>
multica share revoke <project-id>
```

---

## 7. Customer Visibility Model (Leak Safety)

The `GET /public/plan/:token` endpoint is the highest-risk surface in this module. The safety model:

1. **Token validation first**: lookup `plan_share` by token; reject if not found, revoked, or expired. No workspace auth needed.
2. **Scope check**: only `milestones` scope implemented now. Other scopes return 501.
3. **Allowlist projection (not blacklist)**: a dedicated `CustomerPlanView` Go struct contains ONLY these fields:
   - `project.title`
   - `milestones[]` where `customer_visible = true`:  `name`, `committed_date`, `committed_health`
4. **What is NEVER present in `CustomerPlanView`**: internal_date, internal_start, internal_due, buffer margin computed fields, assignee names/ids, workspace id/slug, member list, comment count, task details, agent names, task token, any UUID traceable to a user.
5. **Compile-time safety**: `CustomerPlanView` is a separate Go struct. The projection function `buildCustomerView()` explicitly constructs it field-by-field from the DB result. A forgotten field is a missing field (safe), never an extra leaked field.
6. **Revocation**: DELETE /share or POST /share/rotate invalidates all outstanding tokens for that project immediately.
7. **Expiry**: server-side check on `expires_at` before serving; expired tokens get 410 Gone.

---

## 8. What Exists Today (Baseline)

| Feature | Status |
|---|---|
| Projects | ✅ — table, CRUD, priority, lead, status |
| Tasks/Issues | ✅ — board status, due_date, assignees, labels |
| issue_dependency table | ✅ — but only `blocks/blocked_by/related` types, no DAG/critical-path |
| Milestones | ❌ — not present |
| Dual dates (internal/committed) | ❌ — not present |
| Critical path computation | ❌ — not present |
| Customer share link | ❌ — not present |
| Health rollup | ❌ — not present |
| Planning-specific activity_log | ❌ — not present |
| Blocker tracking | ❌ — not present (issue_dependency has 'blocked_by' but no first-class blocker entity) |

---

## 9. What Remains (Future Waves)

- **Web UI**: Gantt chart, dependency graph visualization, customer portal page at `/share/plan/:token`
- **Mobile**: read-only plan view, milestone notifications
- **Advanced dependency types**: SS/FF with lag
- **What-if simulation**: drag a task → recompute critical path, highlight slip propagation
- **Milestone notifications**: push notifications on at-risk / slip
- **Automated blocker detection**: cron job scanning dependency graph for newly-at-risk pairs
