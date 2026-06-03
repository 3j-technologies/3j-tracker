-- Mobile device push token registration for Expo push notifications.
-- One token per (user_id, device_id) pair. On re-registration the token
-- is upserted so stale tokens are automatically replaced.
CREATE TABLE IF NOT EXISTS device_push_token (
    id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    -- Stable client-generated identifier (e.g. Expo's installationId or
    -- a UUID stored in SecureStore). Allows a user to have multiple devices.
    device_id    TEXT        NOT NULL,
    -- Expo push token e.g. "ExponentPushToken[xxxx]"
    token        TEXT        NOT NULL,
    -- Optional: platform hint for routing decisions (ios/android).
    platform     TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS device_push_token_user_device_idx
    ON device_push_token (user_id, device_id);

CREATE INDEX IF NOT EXISTS device_push_token_user_idx
    ON device_push_token (user_id);
