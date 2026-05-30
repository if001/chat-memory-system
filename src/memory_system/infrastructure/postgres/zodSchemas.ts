import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  memoryConversationChunksTable,
  memoryEpisodeCasesTable,
  memoryPolicyCardsTable,
  memoryPolicySplitCandidatesTable,
  memoryReportsTable,
  memoryTurnRecordsTable,
} from "./schema";

export const memoryTurnRecordSelectSchema = createSelectSchema(
  memoryTurnRecordsTable,
);
export const memoryTurnRecordInsertSchema = createInsertSchema(
  memoryTurnRecordsTable,
);

export const memoryConversationChunkSelectSchema = createSelectSchema(
  memoryConversationChunksTable,
);
export const memoryConversationChunkInsertSchema = createInsertSchema(
  memoryConversationChunksTable,
);

export const memoryEpisodeCaseSelectSchema = createSelectSchema(
  memoryEpisodeCasesTable,
);
export const memoryEpisodeCaseInsertSchema = createInsertSchema(
  memoryEpisodeCasesTable,
);

export const memoryPolicyCardSelectSchema = createSelectSchema(
  memoryPolicyCardsTable,
);
export const memoryPolicyCardInsertSchema = createInsertSchema(
  memoryPolicyCardsTable,
);

export const memoryReportSelectSchema = createSelectSchema(memoryReportsTable);
export const memoryReportInsertSchema = createInsertSchema(memoryReportsTable);

export const memoryPolicySplitCandidateSelectSchema = createSelectSchema(
  memoryPolicySplitCandidatesTable,
);
export const memoryPolicySplitCandidateInsertSchema = createInsertSchema(
  memoryPolicySplitCandidatesTable,
);
