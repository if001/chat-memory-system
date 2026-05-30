import assert from "node:assert/strict";
import { buildMemoryReportSignals } from "../src/memory_system/api/service";
import { PolicyCard } from "../src/memory_system/domain/types";

const now = new Date("2026-05-26T00:00:00.000Z");

const cards: PolicyCard[] = [
  {
    id: "p1",
    botId: "ao",
    title: "Design request",
    appliesWhen: "user asks for design",
    recommendedBehavior: "give options",
    avoidBehavior: "jump to code",
    distinctionNotes: "",
    confidence: "medium",
    evidenceEpisodeIds: ["e1"],
    lastUpdatedIso: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "p2",
    botId: "ao",
    title: "Design request",
    appliesWhen: "user asks for design",
    recommendedBehavior: "implement directly",
    avoidBehavior: "ask questions",
    distinctionNotes: "",
    confidence: "low",
    evidenceEpisodeIds: ["e2"],
    lastUpdatedIso: "2026-05-20T00:00:00.000Z",
  },
];

const report = buildMemoryReportSignals(cards, now);
assert.ok(report.gaps.includes("No high-confidence policy card exists"));
assert.ok(report.staleNotes.some((note) => note.includes("p1")));
assert.ok(
  report.conflicts.some((note) =>
    note
      .toLowerCase()
      .includes("conflicting recommended behavior detected for title: design request"),
  ),
);

const empty = buildMemoryReportSignals([], now);
assert.ok(empty.gaps.includes("No policy cards exist yet for this bot"));
