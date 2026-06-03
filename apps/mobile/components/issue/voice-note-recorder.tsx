/**
 * VoiceNoteRecorder — records a voice note via expo-av and uploads it as an
 * audio attachment to an issue or comment.
 *
 * User flow:
 *   1. Tap mic button → request permission → start recording.
 *   2. Tap stop → recording saved locally → upload to /api/upload-file.
 *   3. On success: calls `onAttached(attachmentId)` so the composer can
 *      include the attachment id in the comment/issue submit payload.
 *
 * Transcription seam: the attachment is uploaded as-is. A future
 * transcription pass will call a backend endpoint to convert audio → text.
 * Per #114 decision: voice capture + save now, AI transcription later.
 *
 * Native rebuild required: expo-av is a native module. This component guards
 * against running on a dev-client binary built before expo-av was added.
 * After `expo run:android / expo run:ios`, the full feature activates.
 */
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/data/api";
import type { FileAsset } from "@/data/api";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

type RecordingState = "idle" | "recording" | "uploading";

interface Props {
  /** Issue or comment context for the upload. */
  uploadContext: { issueId?: string; commentId?: string };
  /** Called with the server attachment id once upload completes. */
  onAttached: (attachmentId: string) => void;
  /** Optional override size for the mic icon button. */
  size?: number;
}

/**
 * Safely import expo-av's Audio. Returns null if the native module is not
 * linked in the current binary (dev-client built before expo-av was added).
 * This avoids a top-level require() which would crash Metro on startup.
 */
function getAudioModule(): typeof import("expo-av")["Audio"] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const av = require("expo-av") as typeof import("expo-av");
    return av.Audio;
  } catch {
    return null;
  }
}

export function VoiceNoteRecorder({ uploadContext, onAttached, size = 24 }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const recordingRef = useRef<unknown>(null);
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? THEME.dark : THEME.light;

  const startRecording = useCallback(async () => {
    const Audio = getAudioModule();
    if (!Audio) {
      Alert.alert(
        "Voice notes unavailable",
        "This feature requires rebuilding the app with native audio support. Run `expo run:android` / `expo run:ios` to enable it.",
      );
      return;
    }
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          "Microphone permission required",
          "Allow Multica to access your microphone to record voice notes.",
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setState("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (err) {
      Alert.alert(
        "Recording failed",
        err instanceof Error ? err.message : "Could not start recording.",
      );
    }
  }, []);

  const stopAndUpload = useCallback(async () => {
    const Audio = getAudioModule();
    if (!Audio) return;
    const recording = recordingRef.current as InstanceType<typeof Audio.Recording> | null;
    if (!recording) return;

    try {
      setState("uploading");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      if (!uri) throw new Error("No recording URI");

      const ext = Platform.OS === "ios" ? "m4a" : "3gp";
      const mimeType = Platform.OS === "ios" ? "audio/m4a" : "audio/3gpp";
      const filename = `voice-note-${Date.now()}.${ext}`;

      const asset: FileAsset = { uri, name: filename, type: mimeType };
      const attachment = await api.uploadFile(asset, uploadContext);

      recordingRef.current = null;
      setState("idle");
      onAttached(attachment.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      recordingRef.current = null;
      setState("idle");
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Could not upload voice note.",
      );
    }
  }, [uploadContext, onAttached]);

  const onPress = useCallback(() => {
    if (state === "idle") startRecording();
    else if (state === "recording") stopAndUpload();
  }, [state, startRecording, stopAndUpload]);

  if (state === "uploading") {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="small" color={theme.primary} />
      </View>
    );
  }

  const isRecording = state === "recording";

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={isRecording ? "Stop recording" : "Record voice note"}
      className={
        isRecording
          ? "h-8 w-8 rounded-full bg-destructive items-center justify-center"
          : "h-8 w-8 items-center justify-center"
      }
    >
      {isRecording ? (
        <Ionicons name="stop" size={size * 0.7} color="white" />
      ) : (
        <Ionicons
          name="mic-outline"
          size={size}
          color={theme.mutedForeground}
        />
      )}
    </Pressable>
  );
}

/**
 * Compact text indicator for active recording. Shown inline in the
 * composer chip row when a recording is in progress.
 */
export function RecordingIndicator() {
  return (
    <View className="flex-row items-center gap-1 px-2 py-1 bg-destructive/10 rounded-full">
      <View className="h-2 w-2 rounded-full bg-destructive" />
      <Text className="text-destructive text-xs font-medium">Recording…</Text>
    </View>
  );
}
