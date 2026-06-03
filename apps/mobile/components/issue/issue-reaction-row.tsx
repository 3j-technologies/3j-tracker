/**
 * Issue-level reaction row. Sits right under the description, mirroring
 * web's `issue-detail.tsx:785` placement.
 *
 * Reads issue.reactions from the detail cache passed by the parent. No
 * separate query — single source of truth on the detail object.
 *
 * Shows reaction chips when reactions exist, plus a "+" add-reaction button
 * that opens the full emoji picker as a formSheet route.
 */
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Issue, IssueReaction } from "@multica/core/types";
import { ReactionBar } from "./reaction-bar";
import { useToggleIssueReaction } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function IssueReactionRow({ issue }: { issue: Issue }) {
  const userId = useAuthStore((s) => s.user?.id);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const reactions: IssueReaction[] = useMemo(
    () => issue.reactions ?? [],
    [issue.reactions],
  );
  const toggle = useToggleIssueReaction(issue.id);
  const { colorScheme } = useColorScheme();
  const iconColor =
    colorScheme === "dark"
      ? THEME.dark.mutedForeground
      : THEME.light.mutedForeground;

  const onToggle = useCallback(
    (emoji: string) => {
      const existing = reactions.find(
        (r) =>
          r.emoji === emoji &&
          r.actor_type === "member" &&
          r.actor_id === userId,
      );
      toggle.mutate({ emoji, existing });
    },
    [reactions, userId, toggle],
  );

  const openEmojiPicker = useCallback(() => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/emoji-picker",
      params: { workspace: wsSlug, id: issue.id },
    });
  }, [wsSlug, issue.id]);

  return (
    <View className="px-4 pb-3 flex-row items-center gap-2">
      {reactions.length > 0 && (
        <ReactionBar
          reactions={reactions}
          currentUserId={userId}
          onToggle={onToggle}
        />
      )}
      {/* "+" add-reaction button — always visible so first reaction is
          accessible without a long-press gesture. */}
      <Pressable
        onPress={openEmojiPicker}
        className="h-7 w-7 rounded-full border border-border items-center justify-center"
        accessibilityLabel="Add reaction"
        hitSlop={8}
      >
        <Ionicons name="add" size={14} color={iconColor} />
      </Pressable>
    </View>
  );
}
