import assert from "node:assert/strict";
import { buildPolicyCardFromEpisodes } from "../src/memory_system/application/usecases/buildPolicyCard";
import {
  buildConversationChunks,
  normalizeChunkingConfig,
} from "../src/memory_system/application/usecases/buildConversationChunks";
import { applyResolvedSplitCandidate } from "../src/memory_system/application/usecases/applyResolvedSplitCandidate";
import { buildPolicyQueryContext } from "../src/memory_system/application/usecases/buildPolicyQueryContext";
import { decidePolicyCardUpdate } from "../src/memory_system/application/usecases/decidePolicyCardUpdate";
import {
  extractEpisodeCase,
  extractEpisodeCaseFromChunk,
} from "../src/memory_system/application/usecases/extractEpisodeCase";
import { filterApplicablePolicyCards } from "../src/memory_system/application/usecases/filterApplicablePolicyCards";
import { mergePolicyCardUpdate } from "../src/memory_system/application/usecases/mergePolicyCardUpdate";
import { transitionPolicySplitCandidate } from "../src/memory_system/application/usecases/transitionPolicySplitCandidate";
import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  PolicySplitCandidate,
  TurnRecord,
} from "../src/memory_system/domain/types";

class OllamaClientStub {
  constructor(private readonly response: unknown) {}

  async generateJson<T>(): Promise<T> {
    return this.response as T;
  }
}

const turnRecord: TurnRecord = {
  id: "turn-1",
  botId: "ao",
  threadId: "thread-1",
  createdAtIso: "2026-05-26T00:00:00.000Z",
  messages: [
    {
      role: "user",
      content: "実装相談です。今回は設計ではなく運用判断を聞いています。",
      timestampIso: "2026-05-26T00:00:00.000Z",
    },
    {
      role: "assistant",
      content: "運用判断として回答します。",
      timestampIso: "2026-05-26T00:00:10.000Z",
    },
  ],
};

const episode = (overrides: Partial<EpisodeCase> = {}): EpisodeCase => ({
  id: "ep-1",
  botId: "ao",
  threadId: "thread-1",
  stateLabel: "implementation decision",
  stateDescription: "User wants a concrete implementation decision.",
  actionLabel: "answer concretely",
  actionDescription: "Answer with concrete steps.",
  outcome: "User accepted the answer.",
  outcomeAssessment: {
    overall: "positive",
    score: 1,
    naturalLanguageJudgement: "The user accepted the answer and moved forward.",
    updateHint: "strengthen",
  },
  feedbackSignals: [],
  policyUpdateNote: "Be concrete.",
  createdAtIso: "2026-05-26T00:00:00.000Z",
  ...overrides,
});

const policyCard = (overrides: Partial<PolicyCard> = {}): PolicyCard => ({
  id: "pc-1",
  botId: "ao",
  title: "Implementation decision support",
  appliesWhen: "User wants a concrete implementation choice.",
  recommendedBehavior: "Answer concretely and compare tradeoffs briefly.",
  avoidBehavior: "Do not stay abstract.",
  distinctionNotes: "Different from research positioning questions.",
  confidence: "high",
  evidenceEpisodeIds: ["ep-1"],
  lastUpdatedIso: "2026-05-26T00:00:00.000Z",
  ...overrides,
});

const splitCandidate = (
  overrides: Partial<PolicySplitCandidate> = {},
): PolicySplitCandidate => ({
  id: "split-1",
  botId: "ao",
  episodeId: "ep-1",
  targetPolicyCardId: "pc-1",
  reason: "Current policy should be split.",
  status: "open",
  createdAtIso: "2026-05-26T00:00:00.000Z",
  ...overrides,
});

const conversationChunk = (
  overrides: Partial<ConversationChunk> = {},
): ConversationChunk => ({
  id: "chunk-1",
  botId: "ao",
  threadId: "thread-1",
  turnRecordIds: ["turn-1", "turn-2"],
  startCreatedAtIso: "2026-05-26T00:00:00.000Z",
  endCreatedAtIso: "2026-05-26T00:01:00.000Z",
  chunkText: "Turn 1\n[user] hello\n\nTurn 2\n[assistant] hi",
  turnCount: 2,
  tokenEstimate: 10,
  createdAtIso: "2026-05-26T00:02:00.000Z",
  ...overrides,
});

const run = async (): Promise<void> => {
  await testNormalizeChunkingConfigDefaults();
  await testNormalizeChunkingConfigRejectsInvalidOverlap();
  await testBuildConversationChunksUsesSlidingWindowOverlap();
  await testBuildConversationChunksKeepsLatestTurnsWhenInputTrimmed();
  await testBuildConversationChunksGeneratesStableTurnIdsWhenMissing();
  await testBuildPolicyQueryContextIncludesRecentTurns();
  await testBuildPolicyQueryContextReturnsCurrentContextWithoutHistory();
  await testBuildPolicyQueryContextReturnsHistoryWithoutCurrentContext();
  await testBuildPolicyQueryContextRespectsTokenBudget();
  await testExtractEpisodeCaseNormalizesFeedbackSignals();
  await testExtractEpisodeCaseRejectsMissingRequiredField();
  await testExtractEpisodeCaseNormalizesOutcomeAssessment();
  await testExtractEpisodeCaseFromChunkUsesChunkIdentity();
  await testBuildPolicyCardSkipsMergeOnStrongSplitSignal();
  await testBuildPolicyCardNormalizesConfidence();
  await testBuildPolicyCardUsesDeterministicIdForSameEpisode();
  await testDecidePolicyCardUpdateReturnsCreateNewWithoutExistingCards();
  await testDecidePolicyCardUpdateUsesOutcomeAssessmentCreateNew();
  await testDecidePolicyCardUpdateUsesNegativeOutcomeAsSplitSignal();
  await testDecidePolicyCardUpdateTargetsSingleExistingCardOnStrongSplit();
  await testDecidePolicyCardUpdateRejectsUnknownMergeTarget();
  await testFilterApplicablePolicyCardsIgnoresUnknownIds();
  await testMergePolicyCardUpdateAppendsEvidenceAndDistinctionNotes();
  await testMergePolicyCardUpdateAdjustsConfidenceFromEpisodeOutcome();
  await testApplyResolvedSplitCandidateUpdatesTargetPolicyCard();
  await testTransitionPolicySplitCandidateResolvesOpenCandidate();
  await testTransitionPolicySplitCandidateRejectsClosedCandidate();
};

const testNormalizeChunkingConfigDefaults = async (): Promise<void> => {
  assert.deepEqual(normalizeChunkingConfig(undefined), {
    chunkSizeTurns: 6,
    chunkOverlapTurns: 2,
  });
};

const testNormalizeChunkingConfigRejectsInvalidOverlap = async (): Promise<void> => {
  assert.throws(
    () =>
      normalizeChunkingConfig({
        chunkSizeTurns: 3,
        chunkOverlapTurns: 3,
      }),
    /must be smaller than chunkSizeTurns/,
  );
};

const testBuildConversationChunksUsesSlidingWindowOverlap = async (): Promise<void> => {
  const turnRecords: TurnRecord[] = Array.from({ length: 5 }, (_, index) => ({
    id: `turn-${index + 1}`,
    botId: "ao",
    threadId: "thread-1",
    createdAtIso: `2026-05-26T00:0${index}:00.000Z`,
    messages: [
      {
        role: "user",
        content: `message-${index + 1}`,
        timestampIso: `2026-05-26T00:0${index}:00.000Z`,
      },
    ],
  }));

  const chunks = buildConversationChunks(turnRecords, {
    chunkSizeTurns: 3,
    chunkOverlapTurns: 1,
  });

  assert.deepEqual(
    chunks.map((chunk) => chunk.turnRecordIds),
    [
      ["turn-1", "turn-2", "turn-3"],
      ["turn-3", "turn-4", "turn-5"],
    ],
  );
};

const testBuildConversationChunksKeepsLatestTurnsWhenInputTrimmed = async (): Promise<void> => {
  const recentOnly = buildConversationChunks(
    Array.from({ length: 4 }, (_, index) => ({
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: `2026-05-26T00:0${index + 6}:00.000Z`,
      messages: [
        {
          role: "user",
          content: `recent-${index + 1}`,
          timestampIso: `2026-05-26T00:0${index + 6}:00.000Z`,
        },
      ],
    })),
    { chunkSizeTurns: 3, chunkOverlapTurns: 1 },
  );

  assert.equal(recentOnly[0]?.turnRecordIds.length, 3);
};

const testBuildConversationChunksGeneratesStableTurnIdsWhenMissing = async (): Promise<void> => {
  const chunks = buildConversationChunks(
    [
      {
        botId: "ao",
        threadId: "thread-1",
        createdAtIso: "2026-05-26T00:06:00.000Z",
        messages: [
          {
            role: "user",
            content: "recent-1",
            timestampIso: "2026-05-26T00:06:00.000Z",
          },
        ],
      },
    ],
    { chunkSizeTurns: 3, chunkOverlapTurns: 1 },
  );

  assert.equal(chunks[0]?.turnRecordIds.length, 1);
  assert.match(chunks[0]?.turnRecordIds[0] ?? "", /^turn_/);
};

const testBuildPolicyQueryContextIncludesRecentTurns = async (): Promise<void> => {
  const recentTurns: TurnRecord[] = [
    {
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-05-26T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "I want a research framing.",
          timestampIso: "2026-05-26T00:00:00.000Z",
        },
        {
          role: "assistant",
          content: "Here is a research framing.",
          timestampIso: "2026-05-26T00:00:01.000Z",
        },
      ],
    },
  ];

  const context = buildPolicyQueryContext(
    "Now I need an implementation decision.",
    recentTurns,
  );

  assert.match(context, /Current user input:/);
  assert.match(context, /Recent conversation history:/);
  assert.match(context, /\[user\] I want a research framing\./);
};

const testBuildPolicyQueryContextReturnsCurrentContextWithoutHistory = async (): Promise<void> => {
  const context = buildPolicyQueryContext("plain current input", []);
  assert.equal(context, "plain current input");
};

const testBuildPolicyQueryContextReturnsHistoryWithoutCurrentContext = async (): Promise<void> => {
  const context = buildPolicyQueryContext("", [
    {
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-05-26T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "I want a research framing.",
          timestampIso: "2026-05-26T00:00:00.000Z",
        },
      ],
    },
  ]);

  assert.match(context, /^Recent conversation history:/);
  assert.doesNotMatch(context, /Current user input:/);
};

const testBuildPolicyQueryContextRespectsTokenBudget = async (): Promise<void> => {
  const recentTurns: TurnRecord[] = [
    {
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-05-26T00:00:00.000Z",
      messages: [
        {
          role: "user",
          content: "old history ".repeat(40),
          timestampIso: "2026-05-26T00:00:00.000Z",
        },
      ],
    },
    {
      botId: "ao",
      threadId: "thread-1",
      createdAtIso: "2026-05-26T00:01:00.000Z",
      messages: [
        {
          role: "user",
          content: "recent short history",
          timestampIso: "2026-05-26T00:01:00.000Z",
        },
      ],
    },
  ];

  const context = buildPolicyQueryContext("current input", recentTurns, 40);

  assert.doesNotMatch(context, /old history/);
  assert.match(context, /recent short history/);
};

const testExtractEpisodeCaseNormalizesFeedbackSignals = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    stateLabel: " operations support ",
    stateDescription: " User asks for operational guidance. ",
    actionLabel: " give runbook ",
    actionDescription: " Provide a small runbook. ",
    outcome: " User can proceed. ",
    outcomeAssessment: {
      overall: "positive",
      score: 1,
      naturalLanguageJudgement: " User can continue. ",
      updateHint: "strengthen",
    },
    feedbackSignals: [
      {
        type: "unknown_type",
        text: " user corrected the framing ",
        strength: "very_high",
        target: "mystery_target",
        updateHint: "mystery_hint",
      },
      {
        type: "preference",
        text: "   ",
        strength: "low",
        target: "policy",
        updateHint: "strengthen",
      },
    ],
    policyUpdateNote: " Keep answers operational. ",
  });

  const result = await extractEpisodeCase(llm as never, turnRecord);

  assert.equal(result.stateLabel, "operations support");
  assert.equal(result.feedbackSignals.length, 1);
  assert.deepEqual(result.feedbackSignals[0], {
    type: "correction",
    text: "user corrected the framing",
    strength: "medium",
    target: "unknown",
    updateHint: "no_change",
  });
};

const testExtractEpisodeCaseRejectsMissingRequiredField = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    stateLabel: "",
    stateDescription: "desc",
    actionLabel: "action",
    actionDescription: "action desc",
    outcome: "outcome",
    outcomeAssessment: {
      overall: "positive",
      score: 1,
      naturalLanguageJudgement: "judgement",
      updateHint: "strengthen",
    },
    feedbackSignals: [],
    policyUpdateNote: "note",
  });

  await assert.rejects(
    () => extractEpisodeCase(llm as never, turnRecord),
    /empty stateLabel/,
  );
};

const testExtractEpisodeCaseNormalizesOutcomeAssessment = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    stateLabel: "operations support",
    stateDescription: "User asks for operational guidance.",
    actionLabel: "give runbook",
    actionDescription: "Provide a small runbook.",
    outcome: "User can proceed.",
    outcomeAssessment: {
      overall: "great",
      score: 9,
      naturalLanguageJudgement: " user stayed engaged but the case is ambiguous ",
      updateHint: "mystery_hint",
    },
    feedbackSignals: [],
    policyUpdateNote: "Keep answers operational.",
  });

  const result = await extractEpisodeCase(llm as never, turnRecord);

  assert.deepEqual(result.outcomeAssessment, {
    overall: "uncertain",
    score: 0,
    naturalLanguageJudgement: "user stayed engaged but the case is ambiguous",
    updateHint: "no_change",
  });
};

const testExtractEpisodeCaseFromChunkUsesChunkIdentity = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    stateLabel: "ops chunk",
    stateDescription: "Chunk-level context",
    actionLabel: "respond",
    actionDescription: "Respond based on chunk",
    outcome: "Resolved",
    outcomeAssessment: {
      overall: "positive",
      score: 1,
      naturalLanguageJudgement: "Chunk shows success.",
      updateHint: "strengthen",
    },
    feedbackSignals: [],
    policyUpdateNote: "Keep this pattern.",
  });

  const result = await extractEpisodeCaseFromChunk(
    llm as never,
    conversationChunk({
      botId: "aka",
      threadId: "thread-9",
    }),
  );

  assert.equal(result.botId, "aka");
  assert.equal(result.threadId, "thread-9");
  assert.equal(result.sourceChunkId, "chunk-1");
};

const testBuildPolicyCardSkipsMergeOnStrongSplitSignal = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    title: "should not be used",
    appliesWhen: "unused",
    recommendedBehavior: "unused",
    avoidBehavior: "unused",
    distinctionNotes: "unused",
    confidence: "high",
  });

  const result = await buildPolicyCardFromEpisodes(llm as never, "ao", [
    episode({
      id: "ep-1",
      feedbackSignals: [
        {
          type: "distinction_request",
          text: "Research questions and implementation decisions must be separated.",
          strength: "high",
          target: "state",
          updateHint: "split",
        },
      ],
    }),
    episode({
      id: "ep-2",
      stateLabel: "research positioning",
      stateDescription: "User wants research positioning.",
    }),
  ]);

  assert.equal(result, null);
};

const testBuildPolicyCardNormalizesConfidence = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    title: " implementation support ",
    appliesWhen: " concrete implementation questions ",
    recommendedBehavior: " answer concretely ",
    avoidBehavior: " stay abstract ",
    distinctionNotes: " separate from research mode ",
    confidence: "very_high",
  });

  const result = await buildPolicyCardFromEpisodes(llm as never, "ao", [episode()]);

  assert.ok(result);
  assert.equal(result.confidence, "low");
  assert.equal(result.title, "implementation support");
};

const testBuildPolicyCardUsesDeterministicIdForSameEpisode = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    title: "implementation support",
    appliesWhen: "implementation questions",
    recommendedBehavior: "answer concretely",
    avoidBehavior: "stay abstract",
    distinctionNotes: "separate from research mode",
    confidence: "medium",
  });

  const first = await buildPolicyCardFromEpisodes(llm as never, "ao", [
    episode({ id: "ep-stable" }),
  ]);
  const second = await buildPolicyCardFromEpisodes(llm as never, "ao", [
    episode({ id: "ep-stable" }),
  ]);

  assert.equal(first?.id, second?.id);
};

const testDecidePolicyCardUpdateReturnsCreateNewWithoutExistingCards = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    decision: "merge",
    reason: "unused because no cards exist",
  });

  const result = await decidePolicyCardUpdate(llm as never, episode(), []);

  assert.deepEqual(result, {
    decision: "create_new",
    reason: "No existing policy cards are available for this bot.",
  });
};

const testDecidePolicyCardUpdateUsesOutcomeAssessmentCreateNew = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    decision: "merge",
    reason: "unused because outcome assessment takes precedence",
  });

  const result = await decidePolicyCardUpdate(
    llm as never,
    episode({
      outcomeAssessment: {
        overall: "mixed",
        score: 0,
        naturalLanguageJudgement: "A new operating mode is emerging.",
        updateHint: "create_new",
      },
    }),
    [policyCard({ id: "pc-1" })],
  );

  assert.deepEqual(result, {
    decision: "create_new",
    reason: "Outcome assessment suggests creating a new policy card.",
  });
};

const testDecidePolicyCardUpdateUsesNegativeOutcomeAsSplitSignal = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    decision: "merge",
    reason: "unused because negative outcome takes precedence",
  });

  const result = await decidePolicyCardUpdate(
    llm as never,
    episode({
      outcomeAssessment: {
        overall: "negative",
        score: -2,
        naturalLanguageJudgement: "The current policy caused a clear mismatch.",
        updateHint: "weaken",
      },
    }),
    [policyCard({ id: "pc-1" })],
  );

  assert.deepEqual(result, {
    decision: "split_existing",
    reason: "Outcome assessment indicates the current policy likely failed.",
    targetPolicyCardId: "pc-1",
  });
};

const testDecidePolicyCardUpdateTargetsSingleExistingCardOnStrongSplit = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    decision: "merge",
    reason: "unused because strong split takes precedence",
  });

  const result = await decidePolicyCardUpdate(
    llm as never,
    episode({
      feedbackSignals: [
        {
          type: "distinction_request",
          text: "This should be separated from the current policy.",
          strength: "high",
          target: "state",
          updateHint: "split",
        },
      ],
    }),
    [policyCard({ id: "pc-1" })],
  );

  assert.deepEqual(result, {
    decision: "split_existing",
    reason: "Episode contains a strong distinction_request split signal.",
    targetPolicyCardId: "pc-1",
  });
};

const testDecidePolicyCardUpdateRejectsUnknownMergeTarget = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    decision: "merge",
    reason: "Looks similar to an existing card.",
    targetPolicyCardId: "pc-missing",
    updatedPolicyCard: {
      title: "Merged card",
      appliesWhen: "When the user asks for concrete implementation help.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Avoid abstraction.",
      distinctionNotes: "Separate from research mode.",
      confidence: "high",
    },
  });

  const result = await decidePolicyCardUpdate(llm as never, episode(), [
    policyCard({ id: "pc-1" }),
  ]);

  assert.equal(result.decision, "merge");
  assert.equal(result.targetPolicyCardId, undefined);
  assert.equal(result.updatedPolicyCard, undefined);
};

const testFilterApplicablePolicyCardsIgnoresUnknownIds = async (): Promise<void> => {
  const llm = new OllamaClientStub({
    applicableIds: ["pc-1", "pc-missing"],
  });

  const result = await filterApplicablePolicyCards(
    llm as never,
    "The user asks for a concrete implementation decision.",
    [
      policyCard({ id: "pc-1" }),
      policyCard({ id: "pc-2", title: "Research positioning" }),
    ],
  );

  assert.deepEqual(
    result.map((card) => card.id),
    ["pc-1"],
  );
};

const testMergePolicyCardUpdateAppendsEvidenceAndDistinctionNotes = async (): Promise<void> => {
  const result = mergePolicyCardUpdate(
    policyCard({
      distinctionNotes: "Existing distinction note.",
      evidenceEpisodeIds: ["ep-1"],
      confidence: "medium",
    }),
    {
      title: "Merged policy",
      appliesWhen: "When implementation advice is needed.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Avoid vague abstraction.",
      distinctionNotes: "Updated distinction note.",
      confidence: "medium",
    },
    episode({
      id: "ep-2",
      feedbackSignals: [
        {
          type: "distinction_request",
          text: "Separate implementation from research framing.",
          strength: "high",
          target: "distinction",
          updateHint: "split",
        },
      ],
    }),
  );

  assert.deepEqual(result.evidenceEpisodeIds, ["ep-1", "ep-2"]);
  assert.match(result.distinctionNotes, /Existing distinction note\./);
  assert.match(result.distinctionNotes, /Updated distinction note\./);
  assert.match(result.distinctionNotes, /Separate implementation from research framing\./);
};

const testMergePolicyCardUpdateAdjustsConfidenceFromEpisodeOutcome = async (): Promise<void> => {
  const raised = mergePolicyCardUpdate(
    policyCard({ confidence: "medium" }),
    {
      title: "Merged policy",
      appliesWhen: "When implementation advice is needed.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Avoid vague abstraction.",
      distinctionNotes: "",
      confidence: "medium",
    },
    episode({
      id: "ep-2",
      outcomeAssessment: {
        overall: "positive",
        score: 1,
        naturalLanguageJudgement: "The policy worked well.",
        updateHint: "strengthen",
      },
      feedbackSignals: [
        {
          type: "achievement",
          text: "The user completed the task.",
          strength: "medium",
          target: "policy",
          updateHint: "strengthen",
        },
      ],
    }),
  );

  const lowered = mergePolicyCardUpdate(
    policyCard({ confidence: "medium" }),
    {
      title: "Merged policy",
      appliesWhen: "When implementation advice is needed.",
      recommendedBehavior: "Answer concretely.",
      avoidBehavior: "Avoid vague abstraction.",
      distinctionNotes: "",
      confidence: "medium",
    },
    episode({
      id: "ep-3",
      outcomeAssessment: {
        overall: "negative",
        score: -1,
        naturalLanguageJudgement: "The policy likely mismatched the situation.",
        updateHint: "weaken",
      },
      feedbackSignals: [
        {
          type: "confusion",
          text: "The user was confused.",
          strength: "medium",
          target: "policy",
          updateHint: "weaken",
        },
      ],
    }),
  );

  assert.equal(raised.confidence, "high");
  assert.equal(lowered.confidence, "low");
};

const testApplyResolvedSplitCandidateUpdatesTargetPolicyCard = async (): Promise<void> => {
  const updated = applyResolvedSplitCandidate(
    policyCard({
      confidence: "high",
      distinctionNotes: "Different from research positioning questions.",
      evidenceEpisodeIds: ["ep-1", "ep-2"],
    }),
    episode({ id: "ep-1" }),
    splitCandidate({
      reason: "Implementation decision and research framing should be separated.",
      status: "resolved",
    }),
  );

  assert.equal(updated.confidence, "medium");
  assert.deepEqual(updated.evidenceEpisodeIds, ["ep-2"]);
  assert.match(updated.distinctionNotes, /Split boundary:/);
};

const testTransitionPolicySplitCandidateResolvesOpenCandidate = async (): Promise<void> => {
  const result = transitionPolicySplitCandidate(splitCandidate(), "resolved");

  assert.deepEqual(result, {
    ...splitCandidate(),
    status: "resolved",
  });
};

const testTransitionPolicySplitCandidateRejectsClosedCandidate = async (): Promise<void> => {
  assert.throws(
    () =>
      transitionPolicySplitCandidate(
        splitCandidate({ status: "ignored" }),
        "resolved",
      ),
    /already ignored/,
  );
};

void run();
