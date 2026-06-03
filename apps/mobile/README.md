# 3J Tracker Mobile (Android + iOS)

Expo SDK 55 + React Native cross-platform client for 3J Tracker. Wires to `@multica/core` for types only — all API calls, state management, and UI are mobile-owned. Theme: "Print-Room Precision" amber-orange brand (h=38 HSL).

## Screens

| Screen | Route |
|--------|-------|
| Login | `/(auth)/login` |
| OTP Verify | `/(auth)/verify` |
| Workspace picker | `/(app)/select-workspace` |
| Inbox | `/(app)/[workspace]/(tabs)/inbox` |
| My Issues | `/(app)/[workspace]/(tabs)/my-issues` |
| Issue detail | `/(app)/[workspace]/issue/[id]` |
| Create issue | `/(app)/[workspace]/new-issue` |
| Projects | `/(app)/[workspace]/more/projects` |
| Chat | `/(app)/[workspace]/(tabs)/chat` |
| More / Settings | `/(app)/[workspace]/(tabs)/more` |

## Quick start (Android emulator)

```bash
# 1. Install dependencies from repo root
export PNPM_STORE_DIR=/Users/mohitshinde/Library/pnpm/store
pnpm install

# 2. Set env (live backend)
cp apps/mobile/.env.example apps/mobile/.env.development.local
# Edit EXPO_PUBLIC_API_URL=https://tracker.3jtech.app

# 3. Start Android emulator (Pixel_5 AVD)
~/Library/Android/sdk/emulator/emulator -avd Pixel_5_clone1 -no-window -no-audio &

# 4. Build + install dev client
export CMAKE_VERSION=3.18.1  # required — cmake 3.22 has ninja bug on macOS
cd apps/mobile && pnpm android

# 5. Set reverse ports (emulator → host)
adb reverse tcp:8085 tcp:8085

# 6. Start Metro on dedicated port
pnpm dev --port 8085
# In the dev client, tap http://10.0.2.2:8085
```

## Quick start (iOS simulator)

```bash
cd apps/mobile && pnpm ios
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | Yes | Tracker backend base URL. Use `https://tracker.3jtech.app` for live, `http://10.0.2.2:8090` for local backend on Android emulator. |

See `.env.example` for a full annotated template.

## E2E tests (Maestro)

Flows are in `.maestro/`. The smoke flow covers: launch → login → verify OTP → workspace → issues list → issue detail.

```bash
# Run smoke test against local backend with dev OTP
~/.maestro/bin/maestro test apps/mobile/.maestro/e2e-smoke.yaml \
  -e APP_BUNDLE_ID=app.tracker.x3jtech.dev \
  -e TEST_EMAIL=test@3jtech.app \
  -e TEST_OTP=123456
```

**Local backend setup for E2E:**
```bash
cd server
DATABASE_URL=... PORT=8090 TRACKER_DEV_VERIFICATION_CODE=123456 APP_ENV=development \
  go run cmd/server/main.go cmd/server/router.go ... &
adb reverse tcp:8090 tcp:8090
```

## Tech stack

- **Expo SDK 55** + **Expo Router** (file-based navigation)
- **React Native 0.83** + **NativeWind 4** (Tailwind v3 in RN)
- **Zustand** (auth + workspace + view stores)
- **TanStack Query v5** (server state, optimistic updates)
- **expo-secure-store** (token storage, mobile-only)
- **@multica/core** (types only — zero runtime coupling)

## cmake note (Android builds on macOS)

cmake 3.22.1 (bundled with Android SDK) has a ninja target-detection bug on macOS ARM64 that breaks `react-native-reanimated`. Fix:

```bash
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "cmake;3.18.1"
export CMAKE_VERSION=3.18.1
```

This is already documented in `android/local.properties`.
