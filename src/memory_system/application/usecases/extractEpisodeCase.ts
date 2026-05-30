import { ConversationChunk, EpisodeCase, TurnRecord } from "../../domain/types";
import { buildEpisodeId, ensureTurnRecordId } from "../../domain/identifiers";
import { OllamaClient } from "../../infrastructure/ollama/client";

interface ExtractEpisodeResult {
  stateLabel: string;
  stateDescription: string;
  actionLabel: string;
  actionDescription: string;
  outcome: string;
  outcomeAssessment: EpisodeCase["outcomeAssessment"];
  feedbackSignals: EpisodeCase["feedbackSignals"];
  policyUpdateNote: string;
}

export const extractEpisodeCase = async (
  llm: OllamaClient,
  record: TurnRecord,
): Promise<EpisodeCase> => {
  const normalizedRecord = ensureTurnRecordId(record);
  return extractEpisodeCaseFromConversationSource(
    llm,
    {
      botId: normalizedRecord.botId,
      threadId: normalizedRecord.threadId,
      id: buildEpisodeId(
        normalizedRecord.botId,
        normalizedRecord.threadId,
        normalizedRecord.id,
      ),
    },
    normalizedRecord,
  );
};

export const extractEpisodeCaseFromChunk = async (
  llm: OllamaClient,
  chunk: ConversationChunk,
): Promise<EpisodeCase> => {
  return extractEpisodeCaseFromConversationSource(
    llm,
    {
      botId: chunk.botId,
      threadId: chunk.threadId,
      sourceChunkId: chunk.id,
      id: buildEpisodeId(chunk.botId, chunk.threadId, chunk.id),
    },
    {
      chunkText: chunk.chunkText,
      turnRecordIds: chunk.turnRecordIds,
      startCreatedAtIso: chunk.startCreatedAtIso,
      endCreatedAtIso: chunk.endCreatedAtIso,
      turnCount: chunk.turnCount,
      tokenEstimate: chunk.tokenEstimate,
    },
  );
};

const extractEpisodeCaseFromConversationSource = async (
  llm: OllamaClient,
  identity: Pick<EpisodeCase, "botId" | "threadId" | "id"> & {
    sourceChunkId?: string;
  },
  conversation: TurnRecord | Record<string, unknown>,
): Promise<EpisodeCase> => {
  const systemPrompt = [
    "You are an episode extractor for conversation memory.",
    "Extract one compact state-action-outcome case from the conversation.",
    "Return JSON only.",
  ].join(" ");
  const userPrompt = JSON.stringify({
    instruction:
      "Extract stateLabel, stateDescription, actionLabel, actionDescription, outcome, outcomeAssessment, feedbackSignals, policyUpdateNote.",
    conversation,
  });
  const parsed = await llm.generateJson<ExtractEpisodeResult>(
    systemPrompt,
    userPrompt,
  );
  return {
    id: identity.id,
    botId: identity.botId,
    threadId: identity.threadId,
    ...(identity.sourceChunkId ? { sourceChunkId: identity.sourceChunkId } : {}),
    stateLabel: requireText(parsed.stateLabel, "stateLabel"),
    stateDescription: requireText(parsed.stateDescription, "stateDescription"),
    actionLabel: requireText(parsed.actionLabel, "actionLabel"),
    actionDescription: requireText(parsed.actionDescription, "actionDescription"),
    outcome: requireText(parsed.outcome, "outcome"),
    outcomeAssessment: normalizeOutcomeAssessment(parsed.outcomeAssessment),
    feedbackSignals: normalizeFeedbackSignals(parsed.feedbackSignals),
    policyUpdateNote: requireText(parsed.policyUpdateNote, "policyUpdateNote"),
    createdAtIso: new Date().toISOString(),
  };
};

const requireText = (value: string, fieldName: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`extractEpisodeCase returned empty ${fieldName}`);
  }
  return normalized;
};

const FEEDBACK_TYPES = new Set<EpisodeCase["feedbackSignals"][number]["type"]>([
  "explicit_positive",
  "explicit_negative",
  "correction",
  "distinction_request",
  "preference",
  "curiosity",
  "achievement",
  "confusion",
  "friction",
  "continuation",
]);

const FEEDBACK_STRENGTHS = new Set<EpisodeCase["feedbackSignals"][number]["strength"]>([
  "low",
  "medium",
  "high",
]);

const FEEDBACK_TARGETS = new Set<EpisodeCase["feedbackSignals"][number]["target"]>([
  "state",
  "action",
  "policy",
  "distinction",
  "unknown",
]);

const UPDATE_HINTS = new Set<EpisodeCase["feedbackSignals"][number]["updateHint"]>([
  "strengthen",
  "weaken",
  "split",
  "merge",
  "avoid",
  "create_new",
  "no_change",
]);

const OUTCOME_OVERALLS = new Set<EpisodeCase["outcomeAssessment"]["overall"]>([
  "positive",
  "mixed",
  "negative",
  "uncertain",
]);

const OUTCOME_SCORES = new Set<EpisodeCase["outcomeAssessment"]["score"]>([
  -2,
  -1,
  0,
  1,
  2,
]);

const normalizeFeedbackSignals = (
  signals: EpisodeCase["feedbackSignals"] | undefined,
): EpisodeCase["feedbackSignals"] => {
  return (signals ?? []).flatMap((signal) => {
    const text = signal?.text?.trim();
    if (!text) {
      return [];
    }
    return [
      {
        type: FEEDBACK_TYPES.has(signal.type) ? signal.type : "correction",
        text,
        strength: FEEDBACK_STRENGTHS.has(signal.strength) ? signal.strength : "medium",
        target: FEEDBACK_TARGETS.has(signal.target) ? signal.target : "unknown",
        updateHint: UPDATE_HINTS.has(signal.updateHint) ? signal.updateHint : "no_change",
      },
    ];
  });
};

const normalizeOutcomeAssessment = (
  value: EpisodeCase["outcomeAssessment"] | undefined,
): EpisodeCase["outcomeAssessment"] => {
  const naturalLanguageJudgement = value?.naturalLanguageJudgement?.trim();
  if (!naturalLanguageJudgement) {
    throw new Error("extractEpisodeCase returned empty outcomeAssessment.naturalLanguageJudgement");
  }
  return {
    overall:
      value?.overall && OUTCOME_OVERALLS.has(value.overall)
        ? value.overall
        : "uncertain",
    score:
      typeof value?.score === "number" && OUTCOME_SCORES.has(value.score)
        ? value.score
        : 0,
    naturalLanguageJudgement,
    updateHint:
      value?.updateHint && UPDATE_HINTS.has(value.updateHint)
        ? value.updateHint
        : "no_change",
  };
};
