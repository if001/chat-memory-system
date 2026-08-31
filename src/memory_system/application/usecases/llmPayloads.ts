import {
  ConversationChunk,
  EpisodeCase,
  PolicyCard,
  TurnMessage,
  TurnRecord,
} from "../../domain/types";

export interface EpisodeLlmPayload {
  state: string;
  action: string;
  outcome: string;
}

export interface PolicyCardLlmPayload extends EpisodeLlmPayload {
  id: string;
}

export const episodeForLlm = (episode: EpisodeCase): EpisodeLlmPayload => ({
  state: episode.state,
  action: episode.action,
  outcome: episode.outcome,
});

export const episodesForLlm = (
  episodes: EpisodeCase[],
): EpisodeLlmPayload[] => episodes.map(episodeForLlm);

export const policyCardForLlm = (card: PolicyCard): PolicyCardLlmPayload => ({
  id: card.id,
  state: card.state,
  action: card.action,
  outcome: card.outcome,
});

export const policyCardsForLlm = (
  cards: PolicyCard[],
): PolicyCardLlmPayload[] => cards.map(policyCardForLlm);

export const turnRecordForLlm = (
  record: TurnRecord,
): { messages: Array<Pick<TurnMessage, "role" | "content">> } => ({
  messages: record.messages.map((message) => ({
    role: message.role,
    content: message.content,
  })),
});

export const conversationChunkForLlm = (
  chunk: ConversationChunk,
): { chunkText: string } => ({
  chunkText: chunk.chunkText,
});
