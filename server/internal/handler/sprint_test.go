package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// createSprintProject creates a project in the handler-test workspace and
// registers a cleanup that deletes the project (which cascades to sprints).
func createSprintProject(t *testing.T, title string) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": title,
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("createSprintProject: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var project ProjectResponse
	json.NewDecoder(w.Body).Decode(&project)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, project.ID)
	})
	return project.ID
}

// createIssueForSprint creates a plain issue in the given project via the handler
// (which auto-assigns the workspace-scoped number) and registers cleanup.
func createIssueForSprint(t *testing.T, projectID string) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      "Sprint helper issue " + projectID,
		"status":     "todo",
		"project_id": projectID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("createIssueForSprint: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var issue IssueResponse
	json.NewDecoder(w.Body).Decode(&issue)
	t.Cleanup(func() {
		r := newRequest("DELETE", "/api/issues/"+issue.ID, nil)
		r = withURLParam(r, "id", issue.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), r)
	})
	return issue.ID
}

// createIssueInSprint creates an issue, assigns it to the sprint, and sets its status.
func createIssueInSprint(t *testing.T, projectID, sprintID, status string) string {
	t.Helper()
	issueID := createIssueForSprint(t, projectID)
	ctx := context.Background()
	// Wire to sprint and set status directly since the handler doesn't accept sprint_id on create
	if _, err := testPool.Exec(ctx,
		`UPDATE issue SET sprint_id = $1, status = $2 WHERE id = $3`,
		sprintID, status, issueID,
	); err != nil {
		t.Fatalf("createIssueInSprint: update: %v", err)
	}
	return issueID
}

// createSprint calls CreateSprint and returns the decoded sprint response.
func createSprint(t *testing.T, projectID, name string) SprintResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+projectID+"/sprints", map[string]any{
		"name": name,
	})
	req = withURLParam(req, "id", projectID)
	testHandler.CreateSprint(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("createSprint: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var sprint SprintResponse
	json.NewDecoder(w.Body).Decode(&sprint)
	return sprint
}

// TestSprintCRUD covers create, get, update, list.
func TestSprintCRUD(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := createSprintProject(t, "Sprint CRUD test project")

	// Create
	w := httptest.NewRecorder()
	start := time.Now().UTC().Format(time.RFC3339)
	end := time.Now().UTC().Add(14 * 24 * time.Hour).Format(time.RFC3339)
	goal := "Ship the MVP"
	req := newRequest("POST", "/api/projects/"+projectID+"/sprints", map[string]any{
		"name":       "Sprint 1",
		"goal":       goal,
		"start_date": start,
		"end_date":   end,
	})
	req = withURLParam(req, "id", projectID)
	testHandler.CreateSprint(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateSprint: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created SprintResponse
	json.NewDecoder(w.Body).Decode(&created)
	if created.Name != "Sprint 1" {
		t.Fatalf("CreateSprint: expected name 'Sprint 1', got %q", created.Name)
	}
	if created.State != "planning" {
		t.Fatalf("CreateSprint: expected state 'planning', got %q", created.State)
	}
	if created.Goal == nil || *created.Goal != goal {
		t.Fatalf("CreateSprint: expected goal %q, got %v", goal, created.Goal)
	}
	if created.ProjectID != projectID {
		t.Fatalf("CreateSprint: expected project_id %q, got %q", projectID, created.ProjectID)
	}
	sprintID := created.ID

	// Get
	w = httptest.NewRecorder()
	req = newRequest("GET", "/api/sprints/"+sprintID, nil)
	req = withURLParam(req, "sprint_id", sprintID)
	testHandler.GetSprint(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetSprint: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var fetched SprintResponse
	json.NewDecoder(w.Body).Decode(&fetched)
	if fetched.ID != sprintID {
		t.Fatalf("GetSprint: id mismatch: got %q want %q", fetched.ID, sprintID)
	}

	// Update
	newName := "Sprint 1 – updated"
	w = httptest.NewRecorder()
	req = newRequest("PATCH", "/api/sprints/"+sprintID, map[string]any{
		"name": newName,
	})
	req = withURLParam(req, "sprint_id", sprintID)
	testHandler.UpdateSprint(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateSprint: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated SprintResponse
	json.NewDecoder(w.Body).Decode(&updated)
	if updated.Name != newName {
		t.Fatalf("UpdateSprint: expected name %q, got %q", newName, updated.Name)
	}
	// Goal should be preserved because UpdateSprint uses COALESCE
	if updated.Goal == nil || *updated.Goal != goal {
		t.Fatalf("UpdateSprint: goal should be preserved, got %v", updated.Goal)
	}

	// List
	w = httptest.NewRecorder()
	req = newRequest("GET", "/api/projects/"+projectID+"/sprints", nil)
	req = withURLParam(req, "id", projectID)
	testHandler.ListSprints(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListSprints: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var listResp map[string]json.RawMessage
	json.NewDecoder(w.Body).Decode(&listResp)
	var sprints []SprintResponse
	json.Unmarshal(listResp["sprints"], &sprints)
	if len(sprints) != 1 {
		t.Fatalf("ListSprints: expected 1 sprint, got %d", len(sprints))
	}
	if sprints[0].ID != sprintID {
		t.Fatalf("ListSprints: sprint id mismatch")
	}
}

// TestCreateSprintRejectsMissingName ensures validation fires.
func TestCreateSprintRejectsMissingName(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, "Sprint validation test project")

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+projectID+"/sprints", map[string]any{
		"name": "",
	})
	req = withURLParam(req, "id", projectID)
	testHandler.CreateSprint(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateSprint empty name: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestStartSprint verifies a sprint transitions from planning → active.
func TestStartSprint(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("StartSprint project %d", time.Now().UnixNano()))
	sprint := createSprint(t, projectID, "Sprint A")

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/sprints/"+sprint.ID+"/start", nil)
	req = withURLParam(req, "sprint_id", sprint.ID)
	testHandler.StartSprint(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("StartSprint: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var started SprintResponse
	json.NewDecoder(w.Body).Decode(&started)
	if started.State != "active" {
		t.Fatalf("StartSprint: expected state 'active', got %q", started.State)
	}
}

// TestStartSprintBlocksSecondActive ensures only one active sprint per project.
func TestStartSprintBlocksSecondActive(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("OneActiveSprint project %d", time.Now().UnixNano()))

	sprint1 := createSprint(t, projectID, "Sprint 1")
	sprint2 := createSprint(t, projectID, "Sprint 2")

	// Start sprint 1
	req := newRequest("POST", "/api/sprints/"+sprint1.ID+"/start", nil)
	req = withURLParam(req, "sprint_id", sprint1.ID)
	testHandler.StartSprint(httptest.NewRecorder(), req)

	// Attempt to start sprint 2 — must conflict
	w := httptest.NewRecorder()
	req = newRequest("POST", "/api/sprints/"+sprint2.ID+"/start", nil)
	req = withURLParam(req, "sprint_id", sprint2.ID)
	testHandler.StartSprint(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("StartSprint second active: expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCompleteSprint verifies active → completed and carry-to-backlog clears sprint_id.
func TestCompleteSprint(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("CompleteSprint project %d", time.Now().UnixNano()))
	sprint := createSprint(t, projectID, "Sprint complete test")

	// Start the sprint
	req := newRequest("POST", "/api/sprints/"+sprint.ID+"/start", nil)
	req = withURLParam(req, "sprint_id", sprint.ID)
	testHandler.StartSprint(httptest.NewRecorder(), req)

	// Seed two issues via the handler (so numbers are auto-assigned), then wire them to the sprint.
	ctx := context.Background()
	issueAID := createIssueInSprint(t, projectID, sprint.ID, "done")
	issueBID := createIssueInSprint(t, projectID, sprint.ID, "todo")

	// Complete sprint with carry_to=backlog
	w := httptest.NewRecorder()
	req = newRequest("POST", "/api/sprints/"+sprint.ID+"/complete", map[string]any{
		"carry_to": "backlog",
	})
	req = withURLParam(req, "sprint_id", sprint.ID)
	testHandler.CompleteSprint(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("CompleteSprint: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var completed SprintResponse
	json.NewDecoder(w.Body).Decode(&completed)
	if completed.State != "completed" {
		t.Fatalf("CompleteSprint: expected state 'completed', got %q", completed.State)
	}

	// Issue A (done) should remain in sprint; issue B (todo/incomplete) carried to backlog
	var aSprintID, bSprintID *string
	testPool.QueryRow(ctx, `SELECT sprint_id::text FROM issue WHERE id = $1`, issueAID).Scan(&aSprintID)
	testPool.QueryRow(ctx, `SELECT sprint_id::text FROM issue WHERE id = $1`, issueBID).Scan(&bSprintID)

	if aSprintID == nil || *aSprintID != sprint.ID {
		t.Fatalf("CompleteSprint: done issue should remain in sprint, got sprint_id=%v", aSprintID)
	}
	if bSprintID != nil {
		t.Fatalf("CompleteSprint: incomplete issue should be cleared (backlog), got sprint_id=%v", bSprintID)
	}
}

// TestAddRemoveTicketFromSprint exercises add + list + remove.
func TestAddRemoveTicketFromSprint(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("TicketSprint project %d", time.Now().UnixNano()))
	sprint := createSprint(t, projectID, "Sprint ticket test")

	// Create an issue via the handler (auto-assigns number)
	ctx := context.Background()
	issueID := createIssueForSprint(t, projectID)

	// Add ticket to sprint (need both sprint_id and ticket_id in chi params simultaneously)
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/sprints/"+sprint.ID+"/tickets/"+issueID, nil)
	req = withURLParams(req, "sprint_id", sprint.ID, "ticket_id", issueID)
	testHandler.AddTicketToSprint(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("AddTicketToSprint: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify via ListSprintIssues
	w = httptest.NewRecorder()
	req = newRequest("GET", "/api/sprints/"+sprint.ID+"/issues", nil)
	req = withURLParam(req, "sprint_id", sprint.ID)
	testHandler.ListSprintIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListSprintIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var issuesResp map[string]json.RawMessage
	json.NewDecoder(w.Body).Decode(&issuesResp)
	var issues []SprintIssueResponse
	json.Unmarshal(issuesResp["issues"], &issues)
	found := false
	for _, iss := range issues {
		if iss.ID == issueID {
			found = true
			if iss.SprintID == nil || *iss.SprintID != sprint.ID {
				t.Fatalf("ListSprintIssues: issue sprint_id = %v, want %q", iss.SprintID, sprint.ID)
			}
		}
	}
	if !found {
		t.Fatalf("ListSprintIssues: issue %q not found in sprint", issueID)
	}

	// Remove ticket from sprint
	w = httptest.NewRecorder()
	req = newRequest("DELETE", "/api/sprints/"+sprint.ID+"/tickets/"+issueID, nil)
	req = withURLParams(req, "sprint_id", sprint.ID, "ticket_id", issueID)
	testHandler.RemoveTicketFromSprint(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("RemoveTicketFromSprint: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Confirm it's gone from sprint issues
	var sprintIDCheck *string
	testPool.QueryRow(ctx, `SELECT sprint_id::text FROM issue WHERE id = $1`, issueID).Scan(&sprintIDCheck)
	if sprintIDCheck != nil {
		t.Fatalf("RemoveTicketFromSprint: issue sprint_id should be NULL, got %v", sprintIDCheck)
	}
}

// TestListBacklog verifies issues with no sprint_id are returned in backlog.
func TestListBacklog(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("Backlog project %d", time.Now().UnixNano()))

	issueID := createIssueForSprint(t, projectID)

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/projects/"+projectID+"/backlog", nil)
	req = withURLParam(req, "id", projectID)
	testHandler.ListBacklog(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListBacklog: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]json.RawMessage
	json.NewDecoder(w.Body).Decode(&resp)
	var issues []SprintIssueResponse
	json.Unmarshal(resp["issues"], &issues)
	found := false
	for _, iss := range issues {
		if iss.ID == issueID {
			found = true
			if iss.SprintID != nil {
				t.Fatalf("ListBacklog: backlog issue should have null sprint_id, got %v", iss.SprintID)
			}
		}
	}
	if !found {
		t.Fatalf("ListBacklog: seeded issue %q not returned", issueID)
	}
}

// TestGetSprintNotFound ensures 404 on unknown sprint UUID.
func TestGetSprintNotFound(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	w := httptest.NewRecorder()
	nonExistent := "00000000-0000-0000-0000-000000000001"
	req := newRequest("GET", "/api/sprints/"+nonExistent, nil)
	req = withURLParam(req, "sprint_id", nonExistent)
	testHandler.GetSprint(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("GetSprint nonexistent: expected 404, got %d", w.Code)
	}
}

// TestGetProjectVelocity verifies the velocity endpoint returns an array
// (possibly empty) without error.
func TestGetProjectVelocity(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("Velocity project %d", time.Now().UnixNano()))

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/projects/"+projectID+"/velocity", nil)
	req = withURLParam(req, "id", projectID)
	testHandler.GetProjectVelocity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetProjectVelocity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]json.RawMessage
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["velocity"]; !ok {
		t.Fatal("GetProjectVelocity: response missing 'velocity' key")
	}
}

// TestGetSprintBurndown verifies the burndown endpoint returns issues array.
func TestGetSprintBurndown(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	projectID := createSprintProject(t, fmt.Sprintf("Burndown project %d", time.Now().UnixNano()))
	sprint := createSprint(t, projectID, "Burndown sprint")

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/sprints/"+sprint.ID+"/burndown", nil)
	req = withURLParam(req, "sprint_id", sprint.ID)
	testHandler.GetSprintBurndown(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetSprintBurndown: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]json.RawMessage
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["issues"]; !ok {
		t.Fatal("GetSprintBurndown: response missing 'issues' key")
	}
}
