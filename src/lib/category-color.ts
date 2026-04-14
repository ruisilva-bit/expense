const DEFAULT_COLORS = [
  "#0ea5e9",
  "#16a34a",
  "#f97316",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#e11d48",
  "#f59e0b",
];

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const hashText = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

export const normalizeHexColor = (value: string | null | undefined) => {
  const color = value?.trim() ?? "";
  if (!HEX_COLOR_REGEX.test(color)) return null;
  return color.toLowerCase();
};

export const fallbackCategoryColor = (key: string) => {
  const index = hashText(key) % DEFAULT_COLORS.length;
  return DEFAULT_COLORS[index];
};

export const resolveCategoryColor = (color: string | null | undefined, key: string) =>
  normalizeHexColor(color) ?? fallbackCategoryColor(key);

