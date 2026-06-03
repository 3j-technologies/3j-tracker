/**
 * AI quick-actions bar for an issue. Renders below the attribute chip row
 * when expanded. Two actions for v1:
 *
 *   1. "Summarize issue" — calls POST /api/issues/{id}/summarize and displays
 *      the result in an inline card.
 *   2. "Draft from voice note" — taps into the VoiceNoteRecorder; after
 *      recording, shows the audio attachment in a chip and attaches it to
 *      the issue as-is. Transcription seam: the attachment id is stored;
 *      a future endpoint can transcribe and fill in the description.
 *
 * The bar is collapsed by default (sparkle button in the issue header).
 * Tapping the sparkle toggles it. Mirrors Linear's "AI" button placement.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  issueId: string;
}

type ActionState = "idle" | "loading" | "done" | "error";

export function AiQuickActions({ issueId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [summaryState, setSummaryState] = useState<ActionState>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? THEME.dark : THEME.light;

  const onSummarize = useCallback(async () => {
    if (summaryState === "loading") return;
    setSummaryState("loading");
    setSummary(null);
    try {
      const result = await api.summarizeIssue(issueId);
      setSummary(result || "No summary available.");
      setSummaryState("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to summarize.";
      setSummary(msg);
      setSummaryState("error");
    }
  }, [issueId, summaryState]);

  return (
    <View className="px-4 pb-2">
      {/* Sparkle toggle button */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center gap-1.5 self-start"
        accessibilityLabel="Toggle AI quick actions"
        hitSlop={8}
      >
        <Ionicons
          name="sparkles-outline"
          size={14}
          color={expanded ? theme.primary : theme.mutedForeground}
        />
        <Text
          className={
            expanded
              ? "text-xs text-primary font-medium"
              : "text-xs text-muted-foreground"
          }
        >
          AI
        </Text>
      </Pressable>

      {expanded && (
        <View className="mt-2 gap-2">
          {/* Summarize action */}
          <Pressable
            onPress={onSummarize}
            disabled={summaryState === "loading"}
            className="flex-row items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card"
            accessibilityLabel="Summarize issue"
          >
            {summaryState === "loading" ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Ionicons name="document-text-outline" size={16} color={theme.primary} />
            )}
            <Text className="text-sm text-foreground flex-1">
              {summaryState === "loading" ? "Summarizing…" : "Summarize this issue"}
            </Text>
          </Pressable>

          {/* Summary result */}
          {summary != null && (
            <View
              className={`px-3 py-2 rounded-lg border ${summaryState === "error" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`}
            >
              <Text
                className={`text-sm leading-relaxed ${summaryState === "error" ? "text-destructive" : "text-foreground"}`}
              >
                {summary}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
