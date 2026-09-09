import type { PolicyCard, TurnRecord } from "../domain/types";
import type { QueryPolicyInput } from "./service";
import type { UserMemoryWriteResult, UserNote } from "../domain/userMemory";
import type {
  DailyEvent,
  GetDailyEventsByDateInput,
  RememberDailyEventInput,
  SearchDailyEventsInput,
} from "../domain/dailyEvent";

export const memoryScopes = [
  "conversation_history",
  "user_memory",
  "daily_events",
  "policy_cards",
] as const;

export type MemoryScope = (typeof memoryScopes)[number];

export type MemoryResult<T> =
  | { status: "found"; data: T }
  | { status: "not_found" }
  | { status: "unavailable"; reason?: string };

export type MemoryLookupResult<T> = MemoryResult<T>;

export interface MemoryCatalogRequest {
  botId: string;
  threadId: string;
  userId: string;
  query?: string;
}

export interface MemoryCatalogEntry {
  available: boolean;
  topics: string[];
  updatedAt?: string;
  dateRange?: { from?: string; to?: string };
}

export interface MemoryCatalog {
  status: "available" | "unavailable";
  conversationHistory: MemoryCatalogEntry;
  userMemory: MemoryCatalogEntry;
  dailyEvents: MemoryCatalogEntry;
  policyCards: MemoryCatalogEntry;
}

export interface MemorySearchRequest {
  botId: string;
  threadId: string;
  userId: string;
  query: string;
  scopes: MemoryScope[];
  limits?: Partial<Record<MemoryScope, number>>;
}

export interface ConversationHistorySearchItem {
  turnRecordId: string;
  occurredAt: string;
  excerpt: string;
}

export interface TurnRecordSearchRequest {
  botId: string;
  threadId: string;
  query: string;
  from?: string;
  to?: string;
  roles?: Array<"system" | "user" | "assistant">;
  kinds?: Array<"human" | "proactive" | "delegation">;
  limit?: number;
}

export interface TurnRecordSearchItem {
  turnRecordId: string;
  occurredAt: string;
  excerpt: string;
}

export interface UserMemorySearchItem {
  noteId: number;
  note: string;
}

export interface DailyEventSearchItem {
  eventId: number;
  eventDate: string;
  summary: string;
}

export interface PolicyCardSearchItem {
  policyCardId: string;
  appliesWhen: string;
  recommendedBehavior: string;
  avoidBehavior?: string;
}

export type ConversationHistorySearchResult = MemoryLookupResult<
  ConversationHistorySearchItem[]
>;
export type UserMemorySearchResult = MemoryLookupResult<UserMemorySearchItem[]>;
export type DailyEventSearchResult = MemoryLookupResult<
  DailyEventSearchItem[]
>;
export type PolicyCardSearchResult = MemoryLookupResult<
  PolicyCardSearchItem[]
>;

export interface MemorySearchResult {
  conversationHistory?: ConversationHistorySearchResult;
  userMemory?: UserMemorySearchResult;
  dailyEvents?: DailyEventSearchResult;
  policyCards?: PolicyCardSearchResult;
}

export interface MemoryClientFacade {
  recordTurn(input: TurnRecord): Promise<void>;
  inspectCatalog(input: MemoryCatalogRequest): Promise<MemoryCatalog>;
  search(input: MemorySearchRequest): Promise<MemorySearchResult>;
  queryApplicablePolicyCards(input: QueryPolicyInput): Promise<PolicyCard[]>;
  rememberUserNote(input: {
    userId: string;
    note: string;
  }): Promise<UserMemoryWriteResult>;
  searchUserNotes(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<UserNote[]>;
  replaceUserNote(input: {
    userId: string;
    noteId: number;
    note: string;
  }): Promise<UserMemoryWriteResult>;
  deleteUserNote(input: { userId: string; noteId: number }): Promise<boolean>;
  rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent>;
  searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]>;
  getDailyEventsByDate(input: GetDailyEventsByDateInput): Promise<DailyEvent[]>;
  searchRelatedTurns(
    input: TurnRecordSearchRequest,
  ): Promise<TurnRecordSearchItem[]>;
  backfillTurnSearchIndex(botId: string, limit?: number): Promise<number>;
}

const memoryScopeSet: ReadonlySet<string> = new Set(memoryScopes);

export const validateMemorySearchRequest = (
  input: MemorySearchRequest,
): MemorySearchRequest => {
  for (const [name, value] of [
    ["botId", input.botId],
    ["threadId", input.threadId],
    ["userId", input.userId],
    ["query", input.query],
  ] as const) {
    if (value.trim().length === 0) {
      throw new TypeError(`${name} must not be empty`);
    }
  }

  if (input.scopes.length === 0) {
    throw new TypeError("scopes must contain at least one memory scope");
  }
  if (new Set(input.scopes).size !== input.scopes.length) {
    throw new TypeError("scopes must not contain duplicates");
  }
  for (const scope of input.scopes) {
    if (!memoryScopeSet.has(scope)) {
      throw new TypeError(`unknown memory scope: ${String(scope)}`);
    }
  }

  for (const [scope, limit] of Object.entries(input.limits ?? {})) {
    if (!memoryScopeSet.has(scope)) {
      throw new TypeError(`unknown memory scope limit: ${scope}`);
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new TypeError(`limit for ${scope} must be a positive integer`);
    }
  }

  return input;
};
