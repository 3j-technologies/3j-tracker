package handler

// push_token.go — device push token registration + Expo push notification delivery.
//
// Endpoints:
//   PUT  /api/me/push-token                — upsert a device push token
//   DELETE /api/me/push-token/:deviceId    — remove a token on logout
//
// NotifyUserViaPush is called from notification_listeners integration points
// for assign / mention / status-change events.
//
// Expo Push API: https://docs.expo.dev/push-notifications/sending-notifications/
// Tokens start with "ExponentPushToken[" or "ExpoPushToken[".

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/logger"
)

// ─── Request types ────────────────────────────────────────────────────────────

type UpsertPushTokenRequest struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	Platform string `json:"platform"` // "ios" | "android"
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// UpsertPushToken registers or updates a device push token for the authenticated user.
// PUT /api/me/push-token
func (h *Handler) UpsertPushToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpsertPushTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.DeviceID == "" || req.Token == "" {
		writeError(w, http.StatusBadRequest, "device_id and token are required")
		return
	}

	userUUID := parseUUID(userID)
	if !userUUID.Valid {
		writeError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO device_push_token (user_id, device_id, token, platform, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, device_id)
		DO UPDATE SET token = EXCLUDED.token, platform = EXCLUDED.platform, updated_at = NOW()
	`, userUUID, req.DeviceID, req.Token, req.Platform)
	if err != nil {
		slog.Error("upsert push token failed",
			append(logger.RequestAttrs(r), "user_id", userID, "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to register push token")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeletePushToken removes a device push token on logout or permission revoke.
// DELETE /api/me/push-token/:deviceId
func (h *Handler) DeletePushToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	deviceID := chi.URLParam(r, "deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "deviceId is required")
		return
	}

	userUUID := parseUUID(userID)
	if !userUUID.Valid {
		writeError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	_, err := h.DB.Exec(r.Context(),
		`DELETE FROM device_push_token WHERE user_id = $1 AND device_id = $2`,
		userUUID, deviceID,
	)
	if err != nil {
		slog.Error("delete push token failed",
			append(logger.RequestAttrs(r), "user_id", userID, "device_id", deviceID, "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to delete push token")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ─── Push delivery ────────────────────────────────────────────────────────────

// PushMessage is the Expo push message shape.
type PushMessage struct {
	To    string         `json:"to"`
	Title string         `json:"title"`
	Body  string         `json:"body"`
	Data  map[string]any `json:"data,omitempty"`
}

// NotifyUserViaPush sends a push notification to all devices registered for
// the given user_id. Errors are logged but not propagated — push delivery is
// best-effort. Call from goroutines; the function itself spawns a goroutine
// for the HTTP delivery.
func (h *Handler) NotifyUserViaPush(ctx context.Context, userID, title, body string, data map[string]any) {
	userUUID := parseUUID(userID)
	if !userUUID.Valid {
		slog.Warn("push notify: invalid user_id", "user_id", userID)
		return
	}

	rows, err := h.DB.Query(ctx,
		`SELECT token FROM device_push_token WHERE user_id = $1`, userUUID,
	)
	if err != nil {
		slog.Warn("push notify: query tokens failed", "user_id", userID, "error", err)
		return
	}
	defer rows.Close()

	var messages []PushMessage
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			continue
		}
		if !strings.HasPrefix(token, "ExponentPushToken[") && !strings.HasPrefix(token, "ExpoPushToken[") {
			continue // skip malformed tokens
		}
		messages = append(messages, PushMessage{
			To:    token,
			Title: title,
			Body:  body,
			Data:  data,
		})
	}
	if err := rows.Err(); err != nil {
		slog.Warn("push notify: row scan error", "user_id", userID, "error", err)
	}
	if len(messages) == 0 {
		return
	}

	go sendExpoPushBatch(messages)
}

// SendExpoPushMessages is an exported alias for sendExpoPushBatch so
// package main's pushNotifier can call it without needing the full Handler.
func SendExpoPushMessages(messages []PushMessage) {
	sendExpoPushBatch(messages)
}

// sendExpoPushBatch fires messages at the Expo push API in a goroutine.
func sendExpoPushBatch(messages []PushMessage) {
	payload, err := json.Marshal(messages)
	if err != nil {
		slog.Error("push: marshal failed", "error", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://exp.host/--/api/v2/push/send",
		bytes.NewReader(payload),
	)
	if err != nil {
		slog.Error("push: build request failed", "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip, deflate")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("push: HTTP call failed", "error", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		slog.Warn("push: Expo API error",
			"status", resp.StatusCode,
			"body", strings.TrimSpace(string(msg)),
		)
		return
	}

	slog.Info("push: delivered", "count", len(messages))
}

// pgtype is used for parseUUID calls above; this blank assignment
// avoids "imported and not used" if the compiler sees only the pgtype.UUID type.
var _ = pgtype.UUID{}
