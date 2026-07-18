import { PolicyCard, PolicyHypothesis } from "../../domain/types";

export const applySplitPolicyUpdate = (
  card: PolicyCard,
  hypothesis: PolicyHypothesis,
): PolicyCard => ({
  ...card,
  state: hypothesis.state,
  action: hypothesis.action,
  outcome: hypothesis.outcome,
  stateEmbeddingVector: hypothesis.stateEmbeddingVector,
  actionEmbeddingVector: hypothesis.actionEmbeddingVector,
  outcomeEmbeddingVector: hypothesis.outcomeEmbeddingVector,
  relatedEpisodeIds: hypothesis.relatedEpisodeIds,
  lastUpdatedIso: new Date().toISOString(),
});
