package handler

// ai_quick_actions.go — thin AI quick-action endpoints used by the mobile app.
//
// Endpoints:
//
//	POST /api/issues/{id}/summarize
//	    Summarises the issue title, description, and most recent comments via an
//	    OpenAI-compatible provider. Reads OPENAI_API_KEY + OPENAI_BASE_URL (falls
//	    back to api.openai.com) from the environment. Returns
//	    { "summary": "..." }. Returns 503 if no API key is configured so callers
//	    can display a graceful degraded state.
//
// Auth: workspace membership required (same guard as GetIssue).
// No new DB tables: this is a pure read + LLM call.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// SummarizeIssueResponse is returned by POST /api/issues/{id}/summarize.
type SummarizeIssueResponse struct {
	Summary string `json:"summary"`
}

// SummarizeIssue summarises an issue using an OpenAI-compatible provider.
func (h *Handler) SummarizeIssue(w http.ResponseWriter, r *http.Request) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		writeError(w, http.StatusServiceUnavailable, "AI provider not configured")
		return
	}

	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}

	// Fetch recent comments for context (cap at 20 most recent).
	comments, err := h.Queries.ListCommentsForIssue(r.Context(), db.ListCommentsForIssueParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		Limit:       20,
	})
	if err != nil {
		slog.Warn("summarize: list comments failed",
			append(logger.RequestAttrs(r), "issue_id", uuidToString(issue.ID), "error", err)...)
		// Non-fatal — summarise without comments.
		comments = nil
	}

	prompt := buildSummarizePrompt(issue, comments)

	baseURL := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}

	summary, err := callOpenAI(r.Context(), baseURL, apiKey, model, prompt)
	if err != nil {
		slog.Error("summarize: LLM call failed",
			append(logger.RequestAttrs(r), "issue_id", uuidToString(issue.ID), "error", err)...)
		writeError(w, http.StatusBadGateway, "failed to generate summary")
		return
	}

	writeJSON(w, http.StatusOK, SummarizeIssueResponse{Summary: summary})
}

// buildSummarizePrompt constructs the user message for the summarise call.
func buildSummarizePrompt(issue db.Issue, comments []db.Comment) string {
	var sb strings.Builder
	sb.WriteString("Summarise this issue in 2-4 sentences covering: what it's about, current status, key decisions or blockers from the discussion.\n\n")
	sb.WriteString("Title: ")
	sb.WriteString(issue.Title)
	sb.WriteString("\nStatus: ")
	sb.WriteString(issue.Status)
	if issue.Description.Valid && issue.Description.String != "" {
		sb.WriteString("\nDescription:\n")
		sb.WriteString(issue.Description.String)
	}
	if len(comments) > 0 {
		sb.WriteString("\n\nComments:\n")
		for i, c := range comments {
			sb.WriteString(fmt.Sprintf("[%d] %s\n", i+1, c.Content))
		}
	}
	return sb.String()
}

// openAIChatRequest is a minimal subset of the OpenAI chat/completions request.
type openAIChatRequest struct {
	Model    string              `json:"model"`
	Messages []openAIChatMessage `json:"messages"`
	MaxTokens int               `json:"max_tokens"`
}

type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// callOpenAI makes a single chat/completions call to an OpenAI-compatible API.
func callOpenAI(ctx context.Context, baseURL, apiKey, model, userPrompt string) (string, error) {
	req := openAIChatRequest{
		Model: model,
		Messages: []openAIChatMessage{
			{Role: "system", Content: "You are a concise project management assistant. Reply with plain text only, no markdown formatting."},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens: 256,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		baseURL+"/v1/chat/completions",
		bytes.NewReader(body),
	)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("http call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("API error %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var parsed openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("empty response from LLM")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}
