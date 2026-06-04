-- Rollback migration 112: Project Planning Module
ALTER TABLE issue_plan DROP CONSTRAINT IF EXISTS fk_issue_plan_milestone;
DROP TABLE IF EXISTS plan_share;
DROP TABLE IF EXISTS plan_blocker;
DROP TABLE IF EXISTS task_dependency;
DROP TABLE IF EXISTS plan_milestone;
DROP TABLE IF EXISTS issue_plan;
