import { PolicyCard } from "../memory_system/domain/types";
import { MemoryRepository } from "../memory_system/infrastructure/postgres/repository";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const buildPolicyCard = (
  botId: string,
  id: string,
  state: string,
  action: string,
  outcome: string,
): PolicyCard => {
  const now = new Date().toISOString();
  return {
    id,
    botId,
    state,
    action,
    outcome,
    stateEmbeddingVector: [],
    actionEmbeddingVector: [],
    outcomeEmbeddingVector: [],
    relatedEpisodeIds: [],
    createdAtIso: now,
    lastUpdatedIso: now,
  };
};

const main = async (): Promise<void> => {
  const botId = process.env.BOT_ID ?? "ao";

  process.stdout.write(`[seed-default-policies] starting for botId=${botId}\n`);

  const repository = new MemoryRepository(required("POSTGRES_URL"));

  const defaultPolicies: PolicyCard[] = [
    buildPolicyCard(
      botId,
      `${botId}-default-concise`,
      "User is asking a simple question or making casual conversation.",
      "Respond briefly, acknowledge the request, and move the conversation forward without unnecessary detail.",
      "The interaction stays lightweight and efficient while still feeling attentive.",
    ),
    buildPolicyCard(
      botId,
      `${botId}-default-delegation`,
      "The request requires deep engineering investigation or high-risk technical judgment.",
      "Escalate detailed engineering research to the specialist agent instead of improvising beyond the available confidence.",
      "Technical work is delegated clearly before the conversation drifts into low-confidence analysis.",
    ),
    buildPolicyCard(
      botId,
      `${botId}-default-friendly`,
      "The assistant is replying in a normal one-to-one conversation.",
      "Use a polite, approachable tone and keep the interaction easy to continue.",
      "The assistant remains competent and warm without becoming stiff or distant.",
    ),
    buildPolicyCard(
      botId,
      `${botId}-default-user-preferences`,
      "The user reveals a durable preference, policy, style, or recurring constraint.",
      "Capture reusable preferences with the user-memory tools after checking for existing notes and resolving conflicts in favor of the latest signal.",
      "Future replies reflect stable user preferences without storing one-off events as long-term memory.",
    ),
  ];

  for (const policy of defaultPolicies) {
    await repository.upsertPolicyCard(policy);
    process.stdout.write(
      `[seed-default-policies] created policy: ${policy.id}\n`,
    );
  }

  process.stdout.write(
    `[seed-default-policies] completed. Created ${defaultPolicies.length} default policy cards.\n`,
  );
  await repository.close();
  process.exit(0);
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stdout.write(`${message}\n`);
  process.exit(1);
});
