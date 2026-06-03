import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config — replaces app.json so we can read APP_ENV at runtime
 * and switch bundleIdentifier / display name for dev / staging / production.
 *
 * APP_ENV is set by package.json scripts:
 *   - dev          → APP_ENV unset (treated as "development")
 *   - dev:staging  → APP_ENV=staging
 *   - dev:prod     → APP_ENV=production (rare; usually only for EAS build)
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? "development";
  const isProd = env === "production";
  const isStaging = env === "staging";

  return {
    ...config,
    name: isProd
      ? "3J Tracker"
      : isStaging
        ? "3J Tracker (Staging)"
        : "3J Tracker (Dev)",
    slug: "3j-tracker-mobile",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    scheme: "3jtracker",
    // 1024x1024 source shared with the desktop client
    // (apps/desktop/build/icon.png). Expo prebuild generates every required
    // iOS icon size from this single PNG.
    icon: "./assets/icon.png",
    ios: {
      supportsTablet: false,
      bundleIdentifier: isProd
        ? (process.env.EXPO_BUNDLE_IDENTIFIER_PROD ?? "app.3jtech.tracker")
        : isStaging
          ? "app.3jtech.tracker.staging"
          : (process.env.EXPO_BUNDLE_IDENTIFIER_DEV ?? "app.3jtech.tracker.dev"),
    },
    android: {
      package: isProd
        ? (process.env.EXPO_ANDROID_PACKAGE_PROD ?? "app.tracker.x3jtech")
        : isStaging
          ? "app.tracker.x3jtech.staging"
          : (process.env.EXPO_ANDROID_PACKAGE_DEV ?? "app.tracker.x3jtech.dev"),
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#f5a623",
      },
      // RECORD_AUDIO is required for voice-note recording (expo-av).
      // Declaring it here ensures every `expo prebuild` generates it in
      // AndroidManifest.xml durably — no manual manifest editing needed.
      permissions: ["android.permission.RECORD_AUDIO"],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "@react-native-community/datetimepicker",
      "react-native-enriched-markdown",
      [
        "expo-image-picker",
        {
          // iOS NSPhotoLibraryUsageDescription. Without this string in
          // Info.plist, calling launchImageLibraryAsync hard-crashes on
          // iOS 14+. Camera is disabled — we only ever read from the
          // existing photo library.
          //
          // NOTE: microphonePermission is intentionally NOT set to false
          // here. Setting it to false causes expo-image-picker to emit
          // tools:node="remove" for RECORD_AUDIO in AndroidManifest.xml,
          // which blocks expo-av from recording voice notes (the manifest
          // merge "remove" directive wins over any "add"). Omitting the
          // option leaves RECORD_AUDIO to expo-av's config plugin
          // (android.permissions below is belt-and-suspenders).
          photosPermission:
            "Allow 3J Tracker to access your photos to attach images to issues and comments.",
          cameraPermission: false,
        },
      ],
      [
        "expo-av",
        {
          // iOS NSMicrophoneUsageDescription — required for audio recording.
          microphonePermission:
            "Allow Multica to record voice notes to attach to issues.",
        },
      ],
      [
        "expo-notifications",
        {
          // Android notification channel / icon colour. iOS permissions
          // are requested at runtime via the hook.
          icon: "./assets/icon.png",
          color: "#f5a623",
          defaultChannel: "tracker-notifications",
          sounds: [],
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            buildReactNativeFromSource: true,
          },
        },
      ],
    ],
    extra: {
      APP_ENV: env,
      // TODO(infra/Mohit): run `eas init` (needs Expo account login) and wire
      // the resulting projectId here so Expo push tokens resolve correctly on
      // real devices:
      //
      //   eas: { projectId: "<uuid-from-eas-init>" },
      //
      // Until this is done, push-token acquisition will fail silently on device.
    },
  };
};
