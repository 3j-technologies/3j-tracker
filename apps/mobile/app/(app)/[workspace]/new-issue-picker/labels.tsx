/**
 * Label picker route for the in-progress new-issue draft. Multi-select with
 * inline create — reuses LabelPickerBody with the same pattern as the
 * existing-issue `issue/[id]/picker/label.tsx`.
 *
 * On create the label is stored in the draft store; actual attachment to the
 * issue happens in new-issue.tsx after CreateIssue succeeds (two-step: create
 * issue → attach labels). This matches web's UX where labels can be set
 * before save and are synced after the issue id is known.
 */
import { useRef } from "react";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { useCreateLabel } from "@/data/mutations/labels";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import type { Label } from "@multica/core/types";

export default function NewIssueLabelPickerRoute() {
  const labels = useNewIssueDraftStore((s) => s.labels);
  const setLabels = useNewIssueDraftStore((s) => s.setLabels);
  const createLabel = useCreateLabel();
  const query = useNativeSearchBar("Search labels", { autoFocus: true });

  const creatingRef = useRef(false);

  const onAttach = (label: Label) => {
    setLabels([...labels.filter((l) => l.id !== label.id), label]);
  };

  const onDetach = (labelId: string) => {
    setLabels(labels.filter((l) => l.id !== labelId));
  };

  const onCreate = (name: string, color: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    createLabel.mutate(
      { name, color },
      {
        onSuccess: (label) => {
          onAttach(label);
        },
        onSettled: () => {
          creatingRef.current = false;
        },
      },
    );
  };

  return (
    <LabelPickerBody
      attached={labels}
      query={query}
      onAttach={onAttach}
      onDetach={onDetach}
      onCreate={onCreate}
    />
  );
}
