// Design workflow stages (shared by the admin pages and the server).
export const STAGES = [
  { id: "new", label: "New", tone: "info" },
  { id: "in_review", label: "In review", tone: "info" },
  { id: "proof_sent", label: "Proof sent", tone: "warning" },
  { id: "changes_requested", label: "Changes requested", tone: "critical" },
  { id: "approved", label: "Approved", tone: "success" },
  { id: "in_production", label: "In production", tone: "success" },
  { id: "done", label: "Done", tone: "neutral" },
  { id: "cancelled", label: "Cancelled", tone: "neutral" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;
export const isStage = (id: unknown): id is StageId => STAGES.some((s) => s.id === id);
