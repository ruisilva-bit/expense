export const COLOR_MODES = ["light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const VISUAL_THEME_IDS = ["minimal", "finance", "ledger", "classic"] as const;
export type VisualThemeId = (typeof VISUAL_THEME_IDS)[number];

export type VisualThemeDefinition = {
  id: VisualThemeId;
  name: string;
  description: string;
};

export const VISUAL_THEMES: readonly VisualThemeDefinition[] = [
  {
    id: "minimal",
    name: "Minimal Modern",
    description: "Clean, calm and contemporary.",
  },
  {
    id: "finance",
    name: "Modern Finance",
    description: "Data-led with an emerald accent.",
  },
  {
    id: "ledger",
    name: "Ledger & Living",
    description: "Warm, tactile and editorial.",
  },
  {
    id: "classic",
    name: "Tailored Europe",
    description: "Forest, ivory and quiet European elegance.",
  },
] as const;

export const DEFAULT_VISUAL_THEME: VisualThemeId = "minimal";
export const COLOR_MODE_STORAGE_KEY = "expense:theme";
export const VISUAL_THEME_STORAGE_KEY = "expense:visual-theme";
export const VISUAL_THEME_METADATA_KEY = "homefund_visual_theme";
export const COLOR_MODE_METADATA_KEY = "homefund_color_mode";

export const THEME_COLOR_BY_VARIANT: Record<VisualThemeId, Record<ColorMode, string>> = {
  minimal: { light: "#f6f7fb", dark: "#0b0d12" },
  finance: { light: "#f3f6f8", dark: "#07111f" },
  ledger: { light: "#f7f1e8", dark: "#0d1514" },
  classic: { light: "#f3f0e8", dark: "#08130e" },
};

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && COLOR_MODES.includes(value as ColorMode);
}

export function isVisualTheme(value: unknown): value is VisualThemeId {
  return typeof value === "string" && VISUAL_THEME_IDS.includes(value as VisualThemeId);
}

function asMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

export function getVisualThemePreference(metadata: unknown): VisualThemeId | null {
  const value = asMetadata(metadata)[VISUAL_THEME_METADATA_KEY];
  return isVisualTheme(value) ? value : null;
}

export function getColorModePreference(metadata: unknown): ColorMode | null {
  const value = asMetadata(metadata)[COLOR_MODE_METADATA_KEY];
  return isColorMode(value) ? value : null;
}

export function buildThemeMetadata(input: {
  visualTheme?: VisualThemeId;
  colorMode?: ColorMode;
}): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (input.visualTheme) metadata[VISUAL_THEME_METADATA_KEY] = input.visualTheme;
  if (input.colorMode) metadata[COLOR_MODE_METADATA_KEY] = input.colorMode;
  return metadata;
}
