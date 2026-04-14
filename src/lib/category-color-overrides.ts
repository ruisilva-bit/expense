import { normalizeHexColor } from "@/lib/category-color";

const STORAGE_KEY = "expense:category-color-overrides";

const readStore = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const color = normalizeHexColor(typeof value === "string" ? value : null);
        return color ? [[key, color]] : [];
      })
    );
  } catch {
    return {};
  }
};

const writeStore = (value: Record<string, string>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

const buildKey = (familyId: string, categoryId: string) => `${familyId}:${categoryId}`;

export const getCategoryColorOverride = (familyId: string, categoryId: string) => {
  if (!familyId || !categoryId) return null;
  const value = readStore()[buildKey(familyId, categoryId)];
  return normalizeHexColor(value);
};

export const setCategoryColorOverride = (familyId: string, categoryId: string, color: string) => {
  if (!familyId || !categoryId) return;
  const normalized = normalizeHexColor(color);
  if (!normalized) return;
  const current = readStore();
  current[buildKey(familyId, categoryId)] = normalized;
  writeStore(current);
};

