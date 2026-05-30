import { EpisodeCase, PolicyCard, PolicyUpdateDecision } from "../../domain/types";
import { OllamaClient } from "../../infrastructure/ollama/client";

interface DecidePolicyUpdateResult {
  decision: PolicyUpdateDecision["decision"];
  reason: string;
  targetPolicyCardId?: string;
  updatedPolicyCard?: {
    title?: string;
    appliesWhen?: string;
    recommendedBehavior?: string;
    avoidBehavior?: string;
    distinctionNotes?: string;
    confidence?: PolicyCard["confidence"] | string;
  };
}

export const decidePolicyCardUpdate = async (
  llm: OllamaClient,
  episode: EpisodeCase,
  existingCards: PolicyCard[],
): Promise<PolicyUpdateDecision> => {
  if (episode.outcomeAssessment.updateHint === "create_new") {
    return {
      decision: "create_new",
      reason: "Outcome assessment suggests creating a new policy card.",
    };
  }
  if (
    episode.outcomeAssessment.updateHint === "split" &&
    existingCards.length > 0
  ) {
    return {
      decision: "split_existing",
      reason: "Outcome assessment suggests splitting the current policy.",
      targetPolicyCardId: existingCards.length === 1 ? existingCards[0]?.id : undefined,
    };
  }
  if (
    episode.outcomeAssessment.overall === "negative" &&
    episode.outcomeAssessment.score <= -1 &&
    existingCards.length > 0
  ) {
    return {
      decision: "split_existing",
      reason: "Outcome assessment indicates the current policy likely failed.",
      targetPolicyCardId: existingCards.length === 1 ? existingCards[0]?.id : undefined,
    };
  }
  if (existingCards.length === 0) {
    return {
      decision: "create_new",
      reason: "No existing policy cards are available for this bot.",
    };
  }

  if (hasStrongSplitSignal(episode)) {
    return {
      decision: "split_existing",
      reason: "Episode contains a strong distinction_request split signal.",
      targetPolicyCardId: existingCards.length === 1 ? existingCards[0]?.id : undefined,
    };
  }

  const systemPrompt = [
    "You decide how to update conversation memory policy cards.",
    "Given one new episode and existing policy cards, decide whether to merge into one card, create a new card, split an existing card, or stay uncertain.",
    "Be conservative about merge decisions.",
    "Return JSON only.",
  ].join(" ");
  const userPrompt = JSON.stringify({
    instruction: [
      "Check whether appliesWhen really matches.",
      "Check whether recommendedBehavior can stay the same.",
      "Check whether avoidBehavior conflicts.",
      "Check whether distinctionNotes say this case should stay separate.",
      "If the episode includes a user distinction request, avoid merge.",
      "Return decision, reason, optional targetPolicyCardId, optional updatedPolicyCard.",
    ].join(" "),
    episode,
    existingPolicyCards: existingCards,
  });

  const parsed = await llm.generateJson<DecidePolicyUpdateResult>(
    systemPrompt,
    userPrompt,
  );
  const decision = normalizeDecision(parsed.decision);
  const reason = normalizeText(parsed.reason) || "No reason provided";
  const targetPolicyCardId =
    parsed.targetPolicyCardId &&
    existingCards.some((card) => card.id === parsed.targetPolicyCardId)
      ? parsed.targetPolicyCardId
      : undefined;

  return {
    decision,
    reason,
    targetPolicyCardId,
    updatedPolicyCard:
      decision === "merge" && targetPolicyCardId
        ? normalizeUpdatedPolicyCard(parsed.updatedPolicyCard)
        : undefined,
  };
};

const hasStrongSplitSignal = (episode: EpisodeCase): boolean => {
  return episode.feedbackSignals.some(
    (signal) =>
      signal.type === "distinction_request" &&
      signal.updateHint === "split" &&
      signal.strength === "high",
  );
};

const normalizeDecision = (
  value: PolicyUpdateDecision["decision"] | string | undefined,
): PolicyUpdateDecision["decision"] => {
  if (
    value === "merge" ||
    value === "create_new" ||
    value === "split_existing" ||
    value === "uncertain"
  ) {
    return value;
  }
  return "uncertain";
};

const normalizeUpdatedPolicyCard = (
  value: DecidePolicyUpdateResult["updatedPolicyCard"],
): PolicyUpdateDecision["updatedPolicyCard"] | undefined => {
  if (!value) {
    return undefined;
  }
  const title = normalizeText(value.title);
  const appliesWhen = normalizeText(value.appliesWhen);
  const recommendedBehavior = normalizeText(value.recommendedBehavior);
  if (!title || !appliesWhen || !recommendedBehavior) {
    return undefined;
  }
  return {
    title,
    appliesWhen,
    recommendedBehavior,
    avoidBehavior: normalizeText(value.avoidBehavior),
    distinctionNotes: normalizeText(value.distinctionNotes),
    confidence: normalizeConfidence(value.confidence),
  };
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? "";

const normalizeConfidence = (
  value: PolicyCard["confidence"] | string | undefined,
): PolicyCard["confidence"] => {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
};
