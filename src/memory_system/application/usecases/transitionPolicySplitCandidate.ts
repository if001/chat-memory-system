import { PolicySplitCandidate, SplitCandidateStatus } from "../../domain/types";

export const transitionPolicySplitCandidate = (
  candidate: PolicySplitCandidate,
  nextStatus: Exclude<SplitCandidateStatus, "open">,
): PolicySplitCandidate => {
  if (candidate.status !== "open") {
    throw new Error(
      `Policy split candidate ${candidate.id} is already ${candidate.status}`,
    );
  }

  return {
    ...candidate,
    status: nextStatus,
  };
};
