-- Migration 112: Project Planning Module
-- Adds: issue_plan, plan_milestone, task_dependency, plan_blocker, plan_share
-- All tables are additive — zero changes to existing tables.

-- ============================================================
-- issue_plan: planning fields per issue (one-to-one extension)
-- ============================================================
CREATE TABLE issue_plan (
    issue_id         UUID PRIMARY KEY REFERENCES issue(id) ON DELETE CASCADE,
    internal_start   TIMESTAMPTZ,
    internal_due     TIMESTAMPTZ,
    committed_start  TIMESTAMPTZ,
    committed_due    TIMESTAMPTZ,
    progress         INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    customer_visible BOOLEAN NOT NULL DEFAULT FALSE,
    is_blocked       BOOLEAN NOT NULL DEFAULT FALSE,
    milestone_id     UUID,   -- FK to plan_milestone added after that table is created
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_issue_plan_milestone ON issue_plan(milestone_id) WHERE milestone_id IS NOT NULL;

-- ============================================================
-- plan_milestone: named committed checkpoints within a project
-- ============================================================
CREATE TABLE plan_milestone (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    description      TEXT,
    internal_date    TIMESTAMPTZ,
    committed_date   TIMESTAMPTZ,
    customer_visible BOOLEAN NOT NULL DEFAULT FALSE,
    status           TEXT NOT NULL DEFAULT 'on_track'
                     CHECK (status IN ('on_track', 'at_risk', 'delayed', 'completed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_milestone_project   ON plan_milestone(project_id);
CREATE INDEX idx_plan_milestone_workspace ON plan_milestone(workspace_id);

-- Add FK from issue_plan to plan_milestone now that it exists
ALTER TABLE issue_plan
    ADD CONSTRAINT fk_issue_plan_milestone
    FOREIGN KEY (milestone_id) REFERENCES plan_milestone(id) ON DELETE SET NULL;

-- ============================================================
-- task_dependency: finish-to-start dependency edges for planning
-- (separate from issue_dependency to keep board compat clean)
-- ============================================================
CREATE TABLE task_dependency (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    predecessor_id UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    successor_id   UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    dep_type       TEXT NOT NULL DEFAULT 'finish_to_start'
                   CHECK (dep_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish')),
    lag_days       INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (predecessor_id, successor_id)
);

CREATE INDEX idx_task_dep_predecessor ON task_dependency(predecessor_id);
CREATE INDEX idx_task_dep_successor   ON task_dependency(successor_id);
CREATE INDEX idx_task_dep_workspace   ON task_dependency(workspace_id);

-- ============================================================
-- plan_blocker: first-class blocker entity
-- ============================================================
CREATE TABLE plan_blocker (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_id          UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('dependency', 'external')),
    blocking_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    reason            TEXT,
    owner_name        TEXT,
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'resolved')),
    resolved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_blocker_issue     ON plan_blocker(issue_id);
CREATE INDEX idx_plan_blocker_workspace ON plan_blocker(workspace_id);
CREATE INDEX idx_plan_blocker_status    ON plan_blocker(issue_id, status);

-- ============================================================
-- plan_share: customer share tokens
-- ============================================================
CREATE TABLE plan_share (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token            TEXT UNIQUE NOT NULL,
    project_id       UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    workspace_id     UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    scope            TEXT NOT NULL DEFAULT 'milestones',
    expires_at       TIMESTAMPTZ,
    revoked_at       TIMESTAMPTZ,
    created_by_type  TEXT CHECK (created_by_type IN ('member', 'agent')),
    created_by_id    UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_share_project ON plan_share(project_id);
CREATE INDEX idx_plan_share_token   ON plan_share(token) WHERE revoked_at IS NULL;
