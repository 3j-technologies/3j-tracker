-- ============================================================
-- issue_plan queries
-- ============================================================

-- name: GetIssuePlan :one
SELECT * FROM issue_plan WHERE issue_id = $1;

-- name: UpsertIssuePlan :one
INSERT INTO issue_plan (
    issue_id, internal_start, internal_due,
    committed_start, committed_due,
    progress, customer_visible, is_blocked, milestone_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
ON CONFLICT (issue_id) DO UPDATE SET
    internal_start   = COALESCE(sqlc.narg('internal_start'),   issue_plan.internal_start),
    internal_due     = COALESCE(sqlc.narg('internal_due'),     issue_plan.internal_due),
    committed_start  = COALESCE(sqlc.narg('committed_start'),  issue_plan.committed_start),
    committed_due    = COALESCE(sqlc.narg('committed_due'),    issue_plan.committed_due),
    progress         = COALESCE(sqlc.narg('progress'),         issue_plan.progress),
    customer_visible = COALESCE(sqlc.narg('customer_visible'), issue_plan.customer_visible),
    is_blocked       = COALESCE(sqlc.narg('is_blocked'),       issue_plan.is_blocked),
    milestone_id     = sqlc.narg('milestone_id'),
    updated_at       = now()
RETURNING *;

-- name: SetIssuePlan :one
INSERT INTO issue_plan (
    issue_id, internal_start, internal_due,
    committed_start, committed_due,
    progress, customer_visible, is_blocked, milestone_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
ON CONFLICT (issue_id) DO UPDATE SET
    internal_start   = EXCLUDED.internal_start,
    internal_due     = EXCLUDED.internal_due,
    committed_start  = EXCLUDED.committed_start,
    committed_due    = EXCLUDED.committed_due,
    progress         = EXCLUDED.progress,
    customer_visible = EXCLUDED.customer_visible,
    is_blocked       = EXCLUDED.is_blocked,
    milestone_id     = EXCLUDED.milestone_id,
    updated_at       = now()
RETURNING *;

-- name: ListIssuePlansForProject :many
SELECT ip.* FROM issue_plan ip
JOIN issue i ON i.id = ip.issue_id
WHERE i.project_id = $1;

-- ============================================================
-- plan_milestone queries
-- ============================================================

-- name: CreateMilestone :one
INSERT INTO plan_milestone (
    workspace_id, project_id, name, description,
    internal_date, committed_date, customer_visible, status
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
) RETURNING *;

-- name: GetMilestone :one
SELECT * FROM plan_milestone WHERE id = $1;

-- name: GetMilestoneInProject :one
SELECT * FROM plan_milestone
WHERE id = $1 AND project_id = $2;

-- name: ListMilestones :many
SELECT * FROM plan_milestone
WHERE project_id = $1
ORDER BY COALESCE(committed_date, internal_date) ASC NULLS LAST, created_at ASC;

-- name: UpdateMilestone :one
UPDATE plan_milestone SET
    name             = COALESCE(sqlc.narg('name'), name),
    description      = sqlc.narg('description'),
    internal_date    = sqlc.narg('internal_date'),
    committed_date   = sqlc.narg('committed_date'),
    customer_visible = COALESCE(sqlc.narg('customer_visible'), customer_visible),
    status           = COALESCE(sqlc.narg('status'), status),
    updated_at       = now()
WHERE id = $1
RETURNING *;

-- name: DeleteMilestone :exec
DELETE FROM plan_milestone WHERE id = $1 AND workspace_id = $2;

-- name: ListCustomerVisibleMilestones :many
SELECT * FROM plan_milestone
WHERE project_id = $1
  AND customer_visible = TRUE
ORDER BY COALESCE(committed_date, internal_date) ASC NULLS LAST;

-- ============================================================
-- task_dependency queries
-- ============================================================

-- name: CreateTaskDependency :one
INSERT INTO task_dependency (
    workspace_id, predecessor_id, successor_id, dep_type, lag_days
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: GetTaskDependency :one
SELECT * FROM task_dependency WHERE id = $1;

-- name: GetTaskDependencyByPair :one
SELECT * FROM task_dependency
WHERE predecessor_id = $1 AND successor_id = $2;

-- name: DeleteTaskDependency :exec
DELETE FROM task_dependency WHERE id = $1 AND workspace_id = $2;

-- name: ListTaskDependenciesForProject :many
SELECT td.* FROM task_dependency td
JOIN issue pred ON pred.id = td.predecessor_id
WHERE pred.project_id = $1
   OR td.successor_id IN (SELECT id FROM issue WHERE project_id = $1)
ORDER BY td.created_at ASC;

-- name: ListSuccessorsOf :many
SELECT td.* FROM task_dependency td
WHERE td.predecessor_id = $1;

-- name: ListPredecessorsOf :many
SELECT td.* FROM task_dependency td
WHERE td.successor_id = $1;

-- name: ListAllDepsInWorkspace :many
-- Used for cycle detection: loads all deps involving issues in a project
SELECT td.* FROM task_dependency td
JOIN issue i ON i.id = td.predecessor_id
WHERE i.workspace_id = $1;

-- ============================================================
-- plan_blocker queries
-- ============================================================

-- name: CreateBlocker :one
INSERT INTO plan_blocker (
    workspace_id, issue_id, kind, blocking_issue_id,
    reason, owner_name, status
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING *;

-- name: GetBlocker :one
SELECT * FROM plan_blocker WHERE id = $1;

-- name: GetBlockerInWorkspace :one
SELECT * FROM plan_blocker WHERE id = $1 AND workspace_id = $2;

-- name: ListBlockersForIssue :many
SELECT * FROM plan_blocker
WHERE issue_id = $1
ORDER BY created_at DESC;

-- name: ListBlockersForProject :many
SELECT pb.* FROM plan_blocker pb
JOIN issue i ON i.id = pb.issue_id
WHERE i.project_id = $1
ORDER BY pb.created_at DESC;

-- name: UpdateBlocker :one
UPDATE plan_blocker SET
    reason      = COALESCE(sqlc.narg('reason'), reason),
    owner_name  = COALESCE(sqlc.narg('owner_name'), owner_name),
    status      = COALESCE(sqlc.narg('status'), status),
    resolved_at = CASE WHEN sqlc.narg('status')::text = 'resolved' THEN now()
                       ELSE resolved_at END,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: DeleteBlocker :exec
DELETE FROM plan_blocker WHERE id = $1 AND workspace_id = $2;

-- ============================================================
-- plan_share queries
-- ============================================================

-- name: CreatePlanShare :one
INSERT INTO plan_share (
    token, project_id, workspace_id, scope,
    expires_at, created_by_type, created_by_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING *;

-- name: GetPlanShareByToken :one
SELECT * FROM plan_share
WHERE token = $1
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now());

-- name: GetActivePlanShareForProject :one
SELECT * FROM plan_share
WHERE project_id = $1
  AND revoked_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: RevokePlanShare :exec
UPDATE plan_share
SET revoked_at = now(), updated_at = now()
WHERE project_id = $1
  AND revoked_at IS NULL;

-- name: GetPlanShareForProject :one
SELECT * FROM plan_share
WHERE project_id = $1
ORDER BY created_at DESC
LIMIT 1;
