import { PolicyCard, PolicyHypothesis } from "../../domain/types";

export const mergePolicyCardUpdate = (
  existing: PolicyCard,
  hypothesis: PolicyHypothesis,
): PolicyCard => ({
  ...existing,
  state: hypothesis.state,
  action: hypothesis.action,
  outcome: hypothesis.outcome,
  stateEmbeddingVector: hypothesis.stateEmbeddingVector,
  actionEmbeddingVector: hypothesis.actionEmbeddingVector,
  outcomeEmbeddingVector: hypothesis.outcomeEmbeddingVector,
  relatedEpisodeIds: uniqueIds([
    ...existing.relatedEpisodeIds,
    ...hypothesis.relatedEpisodeIds,
  ]),
  lastUpdatedIso: new Date().toISOString(),
});

const uniqueIds = (values: string[]): string[] => [...new Set(values)];
