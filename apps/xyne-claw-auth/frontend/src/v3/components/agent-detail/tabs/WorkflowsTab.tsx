import type { ChainWorkflow } from "../../../../lib/api";
import { ChainWorkflowList } from "../../ChainWorkflowList";

interface Props {
  workflows: ChainWorkflow[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (workflow: ChainWorkflow) => void;
  onDelete: (workflow: ChainWorkflow) => void;
  onRequestGlobal: (workflow: ChainWorkflow) => void;
}

export function WorkflowsTab({ workflows, loading, onCreate, onEdit, onDelete, onRequestGlobal }: Props) {
  return (
    <ChainWorkflowList
      workflows={workflows}
      loading={loading}
      onCreate={onCreate}
      onEdit={onEdit}
      onDelete={onDelete}
      onRequestGlobal={onRequestGlobal}
    />
  );
}
