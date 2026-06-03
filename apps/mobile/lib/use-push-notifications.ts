/**
 * usePushNotifications — registers for Expo push notifications and syncs
 * the token with the backend on first auth.
 *
 * Native rebuild required: expo-notifications is a native module that must
 * be compiled into the binary. This file is deliberately written to be a
 * complete no-op when running on a dev-client binary that was built before
 * expo-notifications was added to package.json.
 *
 * Detection strategy: check for `ExpoPushTokenManager` in NativeModules
 * (which is a plain JS object; checking it does NOT trigger the error that
 * accessing `require("expo-notifications")` without the native module does).
 * If the native module is absent, the hook exits immediately.
 *
 * Full activation: after `expo run:android / expo run:ios`, both native
 * modules (`ExpoPushTokenManager`, `ExpoNotifications`) are linked and the
 * complete feature activates.
 */
import { useEffect, useRef } from "react";
import { Platform, NativeModules } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";

function getDeviceId(): string {
  return (Constants.installationId as string | null | undefined) ?? `device-${Platform.OS}`;
}

/**
 * Check if expo-notifications native modules are linked in the current binary.
 * Safe to call without try/catch — NativeModules is always a plain object.
 */
function isPushAvailable(): boolean {
  const nm = NativeModules as Record<string, unknown>;
  return !!nm.ExpoPushTokenManager || !!nm.ExpoNotifications;
}

export function usePushNotifications() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const registeredRef = useRef(false);

  useEffect(() => {
    // Skip entirely if the native module is not in the binary.
    if (!isPushAvailable()) return;
    // Only register once per session.
    if (registeredRef.current) return;
    registeredRef.current = true;

    // Run async — swallow all errors so push failures never crash the app.
    runPushSetup(wsSlug).catch(() => {});
  }, [wsSlug]);
}

async function runPushSetup(wsSlug: string | null): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as typeof import("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Register token.
    const existingPerms = await Notifications.getPermissionsAsync();
    type PermResult = { granted: boolean };
    let granted = (existingPerms as unknown as PermResult).granted;

    if (!granted) {
      const newPerms = await Notifications.requestPermissionsAsync();
      granted = (newPerms as unknown as PermResult).granted;
    }

    if (!granted) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device") as typeof import("expo-device");
    if (!Device.isDevice && Platform.OS !== "android") return;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId as string | undefined,
    });
    const expoPushToken = tokenData.data;
    if (!expoPushToken) return;

    await api.upsertPushToken({
      device_id: getDeviceId(),
      token: expoPushToken,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });

    // Handle notification taps → deep-link.
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const issueId = data?.issue_id as string | undefined;
      const slug = wsSlug ?? (data?.workspace_slug as string | undefined);

      if (issueId && slug) {
        router.push({
          pathname: "/[workspace]/issue/[id]",
          params: { workspace: slug, id: issueId },
        });
      }
    });
  } catch (err) {
    // Non-fatal — push works after binary rebuild.
    console.warn("[push] setup failed (likely missing native module):", err);
  }
}
