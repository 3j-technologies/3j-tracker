/**
 * Full emoji picker for an issue-level reaction. Opened from the issue
 * detail long-press / "+" reaction affordance on the IssueReactionRow.
 *
 * Same pattern as `comment/[commentId]/emoji-picker.tsx` but wires to
 * `useToggleIssueReaction` instead of `useToggleCommentReaction`.
 */
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { EmojiKeyboard, type EmojiType } from "rn-emoji-keyboard";
import type { IssueReaction } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { issueDetailOptions } from "@/data/queries/issues";
import { useToggleIssueReaction } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function IssueEmojiPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const toggle = useToggleIssueReaction(id);
  const { colorScheme } = useColorScheme();

  const { data: issue } = useQuery(issueDetailOptions(wsId, id));

  const reactions = useMemo<IssueReaction[]>(
    () => (issue?.reactions ?? []) as IssueReaction[],
    [issue?.reactions],
  );

  const onSelect = useCallback(
    (picked: EmojiType) => {
      const existing = reactions.find(
        (r) =>
          r.emoji === picked.emoji &&
          r.actor_type === "member" &&
          r.actor_id === userId,
      );
      toggle.mutate({ emoji: picked.emoji, existing });
      router.back();
    },
    [reactions, userId, toggle],
  );

  const theme = colorScheme === "dark" ? THEME.dark : THEME.light;

  if (!issue) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground text-sm">Loading…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <EmojiKeyboard
        onEmojiSelected={onSelect}
        theme={{
          backdrop: theme.background,
          knob: theme.mutedForeground,
          container: theme.background,
          header: theme.foreground,
          skinTonesContainer: theme.card,
          category: {
            icon: theme.mutedForeground,
            iconActive: theme.primary,
            container: theme.card,
            containerActive: theme.primary,
          },
          search: {
            background: theme.card,
            placeholder: theme.mutedForeground,
            text: theme.foreground,
          },
        }}
        enableSearchBar
        expandable={false}
        defaultHeight="100%"
      />
    </View>
  );
}
