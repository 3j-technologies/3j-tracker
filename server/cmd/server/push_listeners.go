package main

// push_listeners.go — registers event bus listeners that deliver Expo push
// notifications to registered mobile devices for key events:
//
//   - issue:assigned   → notify the assignee
//   - issue:mentioned  → notify mentioned members
//   - issue:updated    → notify subscribers of a status change
//
// Push delivery is best-effort: any failure logs a warning but does NOT
// affect the main inbox notification path. This file deliberately
// duplicates the recipient-resolution logic from notification_listeners.go
// to keep concerns cleanly separated (push can be removed without touching
// the inbox path).

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/pkg/protocol"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// pushNotifier wraps the DB pool and DB queries for push delivery,
// mirroring handler.NotifyUserViaPush without coupling to the full Handler.
type pushNotifier struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func (pn *pushNotifier) notify(ctx context.Context, userID, title, body string, data map[string]any) {
	userUUID := parseUUID(userID)
	if !userUUID.Valid {
		return
	}
	rows, err := pn.pool.Query(ctx, `SELECT token FROM device_push_token WHERE user_id = $1`, userUUID)
	if err != nil {
		slog.Warn("push: query tokens failed", "user_id", userID, "error", err)
		return
	}
	defer rows.Close()
	var messages []handler.PushMessage
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			continue
		}
		if len(token) < 10 {
			continue
		}
		messages = append(messages, handler.PushMessage{
			To: token, Title: title, Body: body, Data: data,
		})
	}
	if len(messages) > 0 {
		go handler.SendExpoPushMessages(messages)
	}
}

// registerPushListeners wires up event bus listeners that fire Expo push
// notifications.
func registerPushListeners(bus *events.Bus, pool *pgxpool.Pool, queries *db.Queries) {
	ctx := context.Background()
	pn := &pushNotifier{pool: pool, queries: queries}

	// issue:assigned — notify the new assignee (member only).
	bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		issue, ok := payload["issue"].(handler.IssueResponse)
		if !ok {
			return
		}

		// Only fire when there is a member assignee different from the actor.
		if issue.AssigneeType == nil || *issue.AssigneeType != "member" {
			return
		}
		if issue.AssigneeID == nil || *issue.AssigneeID == e.ActorID {
			return
		}

		go pn.notify(ctx, *issue.AssigneeID,
			"Issue assigned to you",
			issue.Title,
			map[string]any{
				"issue_id": issue.ID,
			},
		)
	})

	// issue:created — notify assignee.
	bus.Subscribe(protocol.EventIssueCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		issue, ok := payload["issue"].(handler.IssueResponse)
		if !ok {
			return
		}
		if issue.AssigneeType == nil || *issue.AssigneeType != "member" {
			return
		}
		if issue.AssigneeID == nil || *issue.AssigneeID == e.ActorID {
			return
		}

		go pn.notify(ctx, *issue.AssigneeID,
			"New issue assigned to you",
			issue.Title,
			map[string]any{
				"issue_id": issue.ID,
			},
		)
	})

	// comment:created — notify issue subscribers.
	bus.Subscribe(protocol.EventCommentCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		comment, _ := payload["comment"].(handler.CommentResponse)
		issueID := comment.IssueID
		if issueID == "" {
			return
		}
		snippet := comment.Content
		if len(snippet) > 80 {
			snippet = snippet[:80] + "…"
		}
		issueTitle, _ := payload["issue_title"].(string)
		notifBody := issueTitle
		if snippet != "" && issueTitle != "" {
			notifBody = issueTitle + ": " + snippet
		}

		subs, err := queries.ListIssueSubscribers(ctx, parseUUID(issueID))
		if err != nil {
			slog.Warn("push: get subscribers failed", "issue_id", issueID, "error", err)
			return
		}
		for _, sub := range subs {
			subID := util.UUIDToString(sub.UserID)
			if subID == e.ActorID || sub.UserType != "member" {
				continue
			}
			go pn.notify(ctx, subID,
				"New comment",
				notifBody,
				map[string]any{"issue_id": issueID},
			)
		}
	})
}
