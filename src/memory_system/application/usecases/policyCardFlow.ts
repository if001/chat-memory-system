import { buildPolicyCardId } from "../../domain/identifiers";
import {
  EpisodeCase,
  PolicyCard,
  PolicyEvaluation,
  PolicyHypothesis,
} from "../../domain/types";

export interface PolicyFlowLogger {
  debug(step: string, payload?: unknown): void;
}

export class PolicyFlowRecoverableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PolicyFlowRecoverableError";
  }
}

export interface PolicyCardFlowPorts {
  buildHypothesis(episodes: EpisodeCase[]): Promise<PolicyHypothesis>;
  searchCards(
    hypothesis: PolicyHypothesis,
    cards: PolicyCard[],
    limit: number,
  ): Promise<PolicyCard[]>;
  evaluateEpisodes(episodes: EpisodeCase[]): Promise<PolicyEvaluation>;
  evaluateSplit(
    groupA: EpisodeCase[],
    groupB: EpisodeCase[],
  ): Promise<PolicyEvaluation>;
  clusterByState(
    episodes: EpisodeCase[],
    newEpisode: EpisodeCase,
  ): Promise<EpisodeCase[][]>;
  clusterByAction(
    episodes: EpisodeCase[],
    newEpisode: EpisodeCase,
  ): Promise<EpisodeCase[][]>;
  logger?: PolicyFlowLogger;
}

export interface PolicyCardFlowCache {
  episodeEvaluations: Map<string, PolicyEvaluation>;
  splitEvaluations: Map<string, PolicyEvaluation>;
  impossibleEpisodeSets: Set<string>;
  cacheHits: number;
}

export interface PolicyCardFlowInput {
  botId: string;
  newEpisode: EpisodeCase;
  existingCards: PolicyCard[];
  episodesByCardId: Map<string, EpisodeCase[]>;
  unassignedEpisodes: EpisodeCase[];
  searchLimit: number;
  ports: PolicyCardFlowPorts;
  cache?: PolicyCardFlowCache;
}

export type PolicyCardFlowResult =
  | {
      outcome: "merged";
      updatedCards: [PolicyCard];
      assignedEpisodeIds: string[];
      stats: PolicyCardFlowStats;
    }
  | {
      outcome: "created";
      updatedCards: [PolicyCard];
      assignedEpisodeIds: string[];
      stats: PolicyCardFlowStats;
    }
  | {
      outcome: "split";
      updatedCards: [PolicyCard, PolicyCard];
      assignedEpisodeIds: string[];
      stats: PolicyCardFlowStats;
    }
  | {
      outcome: "unassigned";
      updatedCards: [];
      assignedEpisodeIds: [];
      recoverableError?: boolean;
      stats: PolicyCardFlowStats;
    };

export interface PolicyCardFlowStats {
  episodeEvalCalls: number;
  splitEvalCalls: number;
  cacheHits: number;
}

export const createPolicyCardFlowCache = (): PolicyCardFlowCache => ({
  episodeEvaluations: new Map(),
  splitEvaluations: new Map(),
  impossibleEpisodeSets: new Set(),
  cacheHits: 0,
});

export const applyEpisodeToPolicyCardFlow = async (
  input: PolicyCardFlowInput,
): Promise<PolicyCardFlowResult> => {
  const cache = input.cache ?? createPolicyCardFlowCache();
  let episodeEvalCalls = 0;
  let splitEvalCalls = 0;
  const log = (step: string, payload?: unknown): void => {
    input.ports.logger?.debug(step, payload);
    // console.log(`[policy-flow] ${step}`, payload ?? "");
  };

  log("step1:new-episode", { episodeId: input.newEpisode.id });
  const baseHypothesis = await recoverable(
    input,
    "step2:build-base-hypothesis",
    () => input.ports.buildHypothesis([input.newEpisode]),
  );
  if (!baseHypothesis) {
    return buildUnassignedResult(cache, episodeEvalCalls, splitEvalCalls, true);
  }

  log("step3:search-cards", { limit: input.searchLimit });
  const candidateCards = await recoverable(input, "step3:search-cards", () =>
    input.ports.searchCards(
      baseHypothesis,
      input.existingCards,
      input.searchLimit,
    ),
  );
  if (!candidateCards) {
    return buildUnassignedResult(cache, episodeEvalCalls, splitEvalCalls, true);
  }
  log("step3: Hypothesisとstatusが類似のcard数: ", {
    cards: candidateCards.length,
  });
  for (const card of candidateCards) {
    const episodes = [
      ...(input.episodesByCardId.get(card.id) ?? []),
      input.newEpisode,
    ];

    log("step3: 類似cardのepisodes+new_episode", {
      card_id: card.id,
      episodes: episodes.length,
    });
    const evaluation = await recoverable(
      input,
      "step5:evaluate-merge-candidate",
      () =>
        evaluateEpisodeSet(episodes, cache, async () => {
          episodeEvalCalls += 1;
          return input.ports.evaluateEpisodes(episodes);
        }),
    );
    log("step5: eval: ", {
      evaluation: evaluation,
    });
    if (!evaluation) {
      return buildUnassignedResult(
        cache,
        episodeEvalCalls,
        splitEvalCalls,
        true,
      );
    }
    log("step5:merge-candidate", {
      cardId: card.id,
      consistent: evaluation.consistent,
      clear: evaluation.clear,
    });
    if (!evaluation.consistent || !evaluation.clear) {
      continue;
    }
    const hypothesis = await recoverable(
      input,
      "step5:build-merged-hypothesis",
      () => input.ports.buildHypothesis(episodes),
    );
    if (!hypothesis) {
      return buildUnassignedResult(
        cache,
        episodeEvalCalls,
        splitEvalCalls,
        true,
      );
    }
    return {
      outcome: "merged",
      updatedCards: [
        buildCardFromHypothesis(
          input.botId,
          hypothesis,
          card.id,
          card.createdAtIso,
        ),
      ],
      assignedEpisodeIds: [input.newEpisode.id],
      stats: buildStats(cache, episodeEvalCalls, splitEvalCalls),
    };
  }

  log("step7:cluster-unassigned");
  const stateClusters = await recoverable(input, "step7:cluster-by-state", () =>
    input.ports.clusterByState(
      [...input.unassignedEpisodes, input.newEpisode],
      input.newEpisode,
    ),
  );
  if (!stateClusters) {
    return buildUnassignedResult(cache, episodeEvalCalls, splitEvalCalls, true);
  }
  for (const stateCluster of stateClusters) {
    if (!containsEpisode(stateCluster, input.newEpisode.id)) {
      continue;
    }
    const actionClusters = await recoverable(
      input,
      "step7:cluster-by-action",
      () => input.ports.clusterByAction(stateCluster, input.newEpisode),
    );
    if (!actionClusters) {
      return buildUnassignedResult(
        cache,
        episodeEvalCalls,
        splitEvalCalls,
        true,
      );
    }
    for (const cluster of actionClusters) {
      if (
        !containsEpisode(cluster, input.newEpisode.id) ||
        cluster.length < 2
      ) {
        continue;
      }
      const evaluation = await recoverable(
        input,
        "step7:evaluate-create-candidate",
        () =>
          evaluateEpisodeSet(cluster, cache, async () => {
            episodeEvalCalls += 1;
            return input.ports.evaluateEpisodes(cluster);
          }),
      );
      if (!evaluation) {
        return buildUnassignedResult(
          cache,
          episodeEvalCalls,
          splitEvalCalls,
          true,
        );
      }
      log("step7:create-candidate", {
        size: cluster.length,
        consistent: evaluation.consistent,
        clear: evaluation.clear,
      });
      if (!evaluation.consistent || !evaluation.clear) {
        continue;
      }
      const hypothesis = await recoverable(
        input,
        "step7:build-created-hypothesis",
        () => input.ports.buildHypothesis(cluster),
      );
      if (!hypothesis) {
        return buildUnassignedResult(
          cache,
          episodeEvalCalls,
          splitEvalCalls,
          true,
        );
      }
      return {
        outcome: "created",
        updatedCards: [buildCardFromHypothesis(input.botId, hypothesis)],
        assignedEpisodeIds: cluster.map((episode) => episode.id),
        stats: buildStats(cache, episodeEvalCalls, splitEvalCalls),
      };
    }
  }

  log("step8:split-candidates");
  for (const card of candidateCards) {
    const relatedEpisodes = input.episodesByCardId.get(card.id) ?? [];
    const clusters = await recoverable(input, "step8:cluster-by-action", () =>
      input.ports.clusterByAction(
        [...relatedEpisodes, input.newEpisode],
        input.newEpisode,
      ),
    );
    if (!clusters) {
      return buildUnassignedResult(
        cache,
        episodeEvalCalls,
        splitEvalCalls,
        true,
      );
    }
    for (const groupA of clusters) {
      if (!containsEpisode(groupA, input.newEpisode.id) || groupA.length < 2) {
        continue;
      }
      const groupAIds = new Set(groupA.map((episode) => episode.id));
      const groupB = relatedEpisodes.filter(
        (episode) => !groupAIds.has(episode.id),
      );
      if (groupB.length === 0) {
        continue;
      }
      const splitKey = buildSplitKey(groupA, groupB);
      const cached = cache.splitEvaluations.get(splitKey);
      const evaluation = cached
        ? ((cache.cacheHits += 1), cached)
        : await recoverable(input, "step8:evaluate-split", () =>
            input.ports.evaluateSplit(groupA, groupB),
          );
      if (!evaluation) {
        return buildUnassignedResult(
          cache,
          episodeEvalCalls,
          splitEvalCalls,
          true,
        );
      }
      if (!cached) {
        splitEvalCalls += 1;
        cache.splitEvaluations.set(splitKey, evaluation);
      }
      log("step8:split-eval", {
        cardId: card.id,
        groupASize: groupA.length,
        groupBSize: groupB.length,
        consistent: evaluation.consistent,
        clear: evaluation.clear,
      });
      if (!evaluation.consistent || !evaluation.clear) {
        continue;
      }
      const splitHypotheses = await recoverable(
        input,
        "step8:build-split-hypotheses",
        () =>
          Promise.all([
            input.ports.buildHypothesis(groupA),
            input.ports.buildHypothesis(groupB),
          ]),
      );
      if (!splitHypotheses) {
        return buildUnassignedResult(
          cache,
          episodeEvalCalls,
          splitEvalCalls,
          true,
        );
      }
      const [hypothesisA, hypothesisB] = splitHypotheses;
      return {
        outcome: "split",
        updatedCards: [
          buildCardFromHypothesis(
            input.botId,
            hypothesisB,
            card.id,
            card.createdAtIso,
          ),
          buildCardFromHypothesis(input.botId, hypothesisA),
        ],
        assignedEpisodeIds: groupA.map((episode) => episode.id),
        stats: buildStats(cache, episodeEvalCalls, splitEvalCalls),
      };
    }
  }

  log("step10:unassigned", { episodeId: input.newEpisode.id });
  return buildUnassignedResult(cache, episodeEvalCalls, splitEvalCalls, false);
};

const evaluateEpisodeSet = async (
  episodes: EpisodeCase[],
  cache: PolicyCardFlowCache,
  evaluate: () => Promise<PolicyEvaluation>,
): Promise<PolicyEvaluation> => {
  const key = buildEpisodeSetKey(episodes);
  const cached = cache.episodeEvaluations.get(key);
  if (cached) {
    cache.cacheHits += 1;
    return cached;
  }

  for (const impossible of cache.impossibleEpisodeSets) {
    if (isSubsetKey(impossible, key)) {
      const result = { consistent: false, clear: false };
      cache.episodeEvaluations.set(key, result);
      cache.cacheHits += 1;
      return result;
    }
  }

  const result = await evaluate();
  cache.episodeEvaluations.set(key, result);
  if (!result.consistent && !result.clear) {
    cache.impossibleEpisodeSets.add(key);
  }
  return result;
};

const buildCardFromHypothesis = (
  botId: string,
  hypothesis: PolicyHypothesis,
  cardId?: string,
  createdAtIso?: string,
): PolicyCard => ({
  id: cardId ?? buildPolicyCardId(botId, hypothesis.relatedEpisodeIds),
  botId,
  state: hypothesis.state,
  action: hypothesis.action,
  outcome: hypothesis.outcome,
  stateEmbeddingVector: hypothesis.stateEmbeddingVector,
  actionEmbeddingVector: hypothesis.actionEmbeddingVector,
  outcomeEmbeddingVector: hypothesis.outcomeEmbeddingVector,
  relatedEpisodeIds: [...hypothesis.relatedEpisodeIds],
  createdAtIso: createdAtIso ?? new Date().toISOString(),
  lastUpdatedIso: new Date().toISOString(),
});

const buildEpisodeSetKey = (episodes: EpisodeCase[]): string =>
  episodes
    .map((episode) => episode.id)
    .sort()
    .join("__");

const buildSplitKey = (groupA: EpisodeCase[], groupB: EpisodeCase[]): string =>
  `${buildEpisodeSetKey(groupA)}::${buildEpisodeSetKey(groupB)}`;

const isSubsetKey = (subsetKey: string, supersetKey: string): boolean => {
  const subset = new Set(subsetKey.split("__"));
  const superset = new Set(supersetKey.split("__"));
  for (const id of subset) {
    if (!superset.has(id)) {
      return false;
    }
  }
  return true;
};

const containsEpisode = (episodes: EpisodeCase[], episodeId: string): boolean =>
  episodes.some((episode) => episode.id === episodeId);

const buildStats = (
  cache: PolicyCardFlowCache,
  episodeEvalCalls: number,
  splitEvalCalls: number,
): PolicyCardFlowStats => ({
  episodeEvalCalls,
  splitEvalCalls,
  cacheHits: cache.cacheHits,
});

const buildUnassignedResult = (
  cache: PolicyCardFlowCache,
  episodeEvalCalls: number,
  splitEvalCalls: number,
  recoverableError: boolean,
): PolicyCardFlowResult => ({
  outcome: "unassigned",
  updatedCards: [],
  assignedEpisodeIds: [],
  recoverableError,
  stats: buildStats(cache, episodeEvalCalls, splitEvalCalls),
});

const recoverable = async <T>(
  input: PolicyCardFlowInput,
  step: string,
  run: () => Promise<T>,
): Promise<T | null> => {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PolicyFlowRecoverableError)) {
      throw error;
    }
    input.ports.logger?.debug(step, {
      level: "warn",
      outcome: "unassigned",
      reason: error.message,
    });
    console.warn(`[policy-flow] ${step} recoverable error`, error.message);
    return null;
  }
};
