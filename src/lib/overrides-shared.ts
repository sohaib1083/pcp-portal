// Labels and rules for super administrator overrides, shared by the server and the browser (no database imports).

export const OVERRIDE_LABELS: Record<string, string> = {
  REASSIGN_OFFICER: "Case officer reassigned",
  EXTEND_DEADLINE: "Deadline extended",
  REOPEN: "Case reopened",
  HOLD: "Administrative hold placed",
  RELEASE_HOLD: "Administrative hold released",
};

export const OVERRIDE_AUDIT: Record<string, string> = {
  REASSIGN_OFFICER: "override.officer.reassigned",
  EXTEND_DEADLINE: "override.deadline.extended",
  REOPEN: "override.case.reopened",
  HOLD: "override.hold.placed",
  RELEASE_HOLD: "override.hold.released",
};

/** A returned (deficiency) or deferred case can be reopened at one of these stages. Never at a decision. */
export const REOPEN_FROM = ["DEFICIENCY_RAISED", "RESPONDED", "DEFERRED"];
export const REOPEN_TO = ["UNDER_SCRUTINY", "TECHNICAL_REVIEW", "COUNCIL_REVIEW"];
