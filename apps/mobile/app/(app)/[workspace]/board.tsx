/**
 * Kanban board screen — columns by status, drag-to-move via status-change
 * action sheet. Mirrors web's board.tsx column layout but uses a simple
 * horizontal ScrollView + column FlatLists since RN has no production-ready
 * drag-between-lists DnD (react-native-draggable-flatlist is single-list only;
 * a multi-column DnD lib isn't in the dependency set). Instead, long-pressing
 * a card shows an ActionSheetIOS with the target status options — same
 * semantic result (status change) without brittle drag physics.
 *
 * Data: reuses `issueListOptions(wsId)` (same workspace-wide issue list
 * cache as the Issues tab) to avoid a double fetch. Groups client-side by
 * status, same as the issues list screen.
 *
 * Presented as a Stack screen from the more/ menu and from a board-icon
 * button in the My Issues tab toolbar.
 */
import { useCallback, useMemo } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import type { Issue, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Header } from "@/components/ui/header";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { issueListOptions, issueKeys } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { BOARD_STATUSES, STATUS_LABEL } from "@/lib/issue-status";
import { api } from "@/data/api";

const COLUMN_WIDTH = 280;
const COLUMN_GAP = 12;

type StatusColumn = { status: IssueStatus; issues: Issue[] };

export default function BoardScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data: rawIssues = [], isLoading } = useQuery(issueListOptions(wsId));
  const qc = useQueryClient();

  const columns = useMemo<StatusColumn[]>(() => {
    const map = new Map<IssueStatus, Issue[]>();
    for (const s of BOARD_STATUSES) map.set(s, []);
    for (const issue of rawIssues) {
      const bucket = map.get(issue.status as IssueStatus);
      if (bucket) bucket.push(issue);
    }
    return BOARD_STATUSES.map((s) => ({ status: s, issues: map.get(s) ?? [] }));
  }, [rawIssues]);

  const moveIssue = useCallback(
    async (issue: Issue, targetStatus: IssueStatus) => {
      if (issue.status === targetStatus) return;
      // Optimistic patch: update the issue's status in the list cache.
      const key = issueKeys.list(wsId);
      qc.setQueryData<Issue[]>(key, (prev) =>
        prev?.map((i) =>
          i.id === issue.id ? { ...i, status: targetStatus } : i,
        ) ?? prev,
      );
      try {
        await api.updateIssue(issue.id, { status: targetStatus });
      } catch {
        // Roll back on failure.
        qc.invalidateQueries({ queryKey: key });
      }
    },
    [wsId, qc],
  );

  const onLongPress = useCallback(
    (issue: Issue) => {
      Haptics.selectionAsync().catch(() => {});
      const options = BOARD_STATUSES.filter((s) => s !== issue.status);
      const labels = options.map((s) => STATUS_LABEL[s]);
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: [...labels, "Cancel"], cancelButtonIndex: labels.length },
          (idx) => {
            if (idx < labels.length) {
              const target = options[idx];
              if (target) moveIssue(issue, target);
            }
          },
        );
      } else {
        // Android: simple Alert (ActionSheetIOS is iOS-only).
        // A full Android action sheet would require a custom modal; out of
        // scope for v1 — long-press shows a plain Alert list.
        Alert.alert("Move to", "", [
          ...options.map((s) => ({
            text: STATUS_LABEL[s],
            onPress: () => moveIssue(issue, s),
          })),
          { text: "Cancel", style: "cancel" },
        ]);
      }
    },
    [moveIssue],
  );

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Header title="Board" />
        <IssuesLoading />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Header title="Board" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 24,
          gap: COLUMN_GAP,
          flexDirection: "row",
        }}
      >
        {columns.map((col) => (
          <View
            key={col.status}
            style={{ width: COLUMN_WIDTH }}
            className="flex-shrink-0"
          >
            {/* Column header */}
            <View className="flex-row items-center gap-2 pb-3 pt-4">
              <StatusIcon status={col.status} size={14} />
              <Text className="text-sm font-semibold text-foreground">
                {STATUS_LABEL[col.status]}
              </Text>
              <Text className="text-xs text-muted-foreground">
                ({col.issues.length})
              </Text>
            </View>

            {/* Issue cards */}
            <FlatList
              data={col.issues}
              keyExtractor={(i) => i.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View className="h-2" />}
              renderItem={({ item }) => (
                <Pressable
                  testID={`board-issue-${item.id}`}
                  onPress={() => {
                    if (!wsSlug) return;
                    router.push({
                      pathname: "/[workspace]/issue/[id]",
                      params: { workspace: wsSlug, id: item.id },
                    });
                  }}
                  onLongPress={() => onLongPress(item)}
                  delayLongPress={400}
                  className="bg-card rounded-xl border border-border p-3 gap-1.5"
                >
                  <Text
                    className="text-sm font-medium text-foreground leading-snug"
                    numberOfLines={3}
                  >
                    {item.title}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {item.identifier}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View
                  className="h-20 items-center justify-center rounded-xl border border-dashed border-border"
                >
                  <Text className="text-xs text-muted-foreground">No issues</Text>
                </View>
              }
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
