export type GoalMoveType = "allocate" | "release" | "spend";

const GOAL_TAG_REGEX = /\[goal:([0-9a-fA-F-]{36})\]/;
const GOAL_TAG_STRIP_REGEX = /\s*\[goal:[0-9a-fA-F-]{36}\]\s*/g;
const GOAL_MOVE_TAG_REGEX = /\[goal-move:(allocate|release|spend)\]/;
const GOAL_MOVE_TAG_STRIP_REGEX = /\s*\[goal-move:(?:allocate|release|spend)\]\s*/g;

export const extractGoalTag = (description: string | null | undefined) => {
  if (!description) return null;
  const match = description.match(GOAL_TAG_REGEX);
  return match?.[1] ?? null;
};

export const extractGoalMoveType = (description: string | null | undefined): GoalMoveType | null => {
  if (!description) return null;
  const match = description.match(GOAL_MOVE_TAG_REGEX);
  const type = match?.[1];
  return type === "allocate" || type === "release" || type === "spend" ? type : null;
};

export const extractGoalMove = (description: string | null | undefined) => {
  const goalId = extractGoalTag(description);
  const moveType = extractGoalMoveType(description);
  if (!goalId || !moveType) return null;
  return { goalId, moveType };
};

export const stripGoalTags = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description
    .replace(GOAL_TAG_STRIP_REGEX, " ")
    .replace(GOAL_MOVE_TAG_STRIP_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
};

export const withGoalMoveTags = (description: string | null | undefined, goalId: string, moveType: GoalMoveType) => {
  const base = stripGoalTags(description);
  const suffix = `[goal:${goalId}] [goal-move:${moveType}]`;
  return base ? `${base} ${suffix}` : suffix;
};

export const isGoalReservationMove = (description: string | null | undefined) => {
  const moveType = extractGoalMoveType(description);
  return moveType === "allocate" || moveType === "release";
};
