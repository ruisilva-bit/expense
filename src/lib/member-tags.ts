const MEMBER_TAG_REGEX = /\s*\[members:([^\]]+)\]\s*/i;
const UUID_REGEX = /^[0-9a-fA-F-]{36}$/;

const normalizeMemberIds = (memberIds: string[]) =>
  Array.from(
    new Set(
      memberIds
        .map((value) => value.trim())
        .filter((value) => UUID_REGEX.test(value))
    )
  );

export const extractMemberIdsFromDescription = (description: string | null | undefined) => {
  if (!description) return [] as string[];
  const match = description.match(MEMBER_TAG_REGEX);
  if (!match?.[1]) return [] as string[];
  return normalizeMemberIds(match[1].split(","));
};

export const stripMemberTag = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description.replace(MEMBER_TAG_REGEX, " ").trim();
  return stripped || null;
};

export const withMemberIdsTag = (description: string | null | undefined, memberIds: string[]) => {
  const base = stripMemberTag(description);
  const normalizedIds = normalizeMemberIds(memberIds);
  if (!normalizedIds.length) return base;
  const tag = `[members:${normalizedIds.join(",")}]`;
  return base ? `${base} ${tag}` : tag;
};

export const effectiveMemberIds = (assignedTo: string | null | undefined, description: string | null | undefined) => {
  const tagged = extractMemberIdsFromDescription(description);
  if (tagged.length) return tagged;
  return assignedTo ? [assignedTo] : [];
};

export const matchesMemberFilter = (
  assignedTo: string | null | undefined,
  description: string | null | undefined,
  selectedMemberIds: string[]
) => {
  if (!selectedMemberIds.length) return true;
  const selected = new Set(selectedMemberIds);
  const members = effectiveMemberIds(assignedTo, description);
  return members.some((memberId) => selected.has(memberId));
};
