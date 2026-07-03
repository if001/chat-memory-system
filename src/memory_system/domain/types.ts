export type FeedbackType =
  | "explicit_positive"
  | "explicit_negative"
  | "correction"
  | "distinction_request"
  | "preference"
  | "curiosity"
  | "achievement"
  | "confusion"
  | "friction"
  | "continuation";

export type FeedbackStrength = "low" | "medium" | "high";
export type FeedbackTarget =
  | "state"
  | "action"
  | "policy"
  | "distinction"
  | "unknown";

export type UpdateHint =
  | "strengthen"
  | "weaken"
  | "split"
  | "merge"
  | "avoid"
  | "create_new"
  | "no_change";

export type OutcomeOverall = "positive" | "mixed" | "negative" | "uncertain";

export interface FeedbackSignal {
  type: FeedbackType;
  text: string;
  strength: FeedbackStrength;
  target: FeedbackTarget;
  updateHint: UpdateHint;
}

export interface OutcomeAssessment {
  overall: OutcomeOverall;
  score: -2 | -1 | 0 | 1 | 2;
  naturalLanguageJudgement: string;
  updateHint: UpdateHint;
}

export interface TurnMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestampIso: string;
}

export interface TurnRecord {
  id?: string;
  botId: string;
  threadId: string;
  messages: TurnMessage[];
  createdAtIso: string;
}

export interface ConversationChunk {
  id: string;
  botId: string;
  threadId: string;
  turnRecordIds: string[];
  startCreatedAtIso: string;
  endCreatedAtIso: string;
  chunkText: string;
  turnCount: number;
  tokenEstimate: number;
  createdAtIso: string;
  processedAtIso?: string;
}

export interface ChunkingConfig {
  chunkSizeTurns: number;
  chunkOverlapTurns: number;
}

export interface EpisodeCase {
  id: string;
  botId: string;
  threadId: string;
  sourceChunkId?: string;
  stateLabel: string;
  stateDescription: string;
  actionLabel: string;
  actionDescription: string;
  outcome: string;
  outcomeAssessment: OutcomeAssessment;
  feedbackSignals: FeedbackSignal[];
  policyUpdateNote: string;
  createdAtIso: string;
}

export type PolicyConfidence = "low" | "medium" | "high";

export interface PolicyCard {
  id: string;
  botId: string;
  title: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior: string;
  distinctionNotes: string;
  confidence: PolicyConfidence;
  evidenceEpisodeIds: string[];
  lastUpdatedIso: string;
}

export type PolicyUpdateDecisionType =
  | "merge"
  | "create_new"
  | "split_existing"
  | "uncertain";

export interface PolicyUpdateDecision {
  decision: PolicyUpdateDecisionType;
  reason: string;
  targetPolicyCardId?: string;
}

export type SplitCandidateStatus = "open" | "resolved" | "ignored";

export interface PolicySplitCandidate {
  id: string;
  botId: string;
  episodeId: string;
  targetPolicyCardId?: string;
  reason: string;
  status: SplitCandidateStatus;
  createdAtIso: string;
}

export interface MemoryReport {
  botId: string;
  threadId: string;
  gaps: string[];
  staleNotes: string[];
  conflicts: string[];
  createdAtIso: string;
}

export interface RelationshipInsightReport {
  botId: string;
  threadId: string;
  clarificationCandidates: string[];
  proactiveContextCandidates: string[];
  repairCandidates: string[];
  boundaryCandidates: string[];
  createdAtIso: string;
}
