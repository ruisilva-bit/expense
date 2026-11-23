import assert from "node:assert/strict";
import test from "node:test";
import {
  COLOR_MODE_METADATA_KEY,
  DEFAULT_VISUAL_THEME,
  VISUAL_THEME_METADATA_KEY,
  buildThemeMetadata,
  getColorModePreference,
  getVisualThemePreference,
  isColorMode,
  isVisualTheme,
} from "./theme-preferences";

test("theme preference guards accept only supported values", () => {
  assert.equal(isVisualTheme("minimal"), true);
  assert.equal(isVisualTheme("ledger"), true);
  assert.equal(isVisualTheme("classic"), true);
  assert.equal(isVisualTheme("unknown"), false);
  assert.equal(isColorMode("dark"), true);
  assert.equal(isColorMode("system"), false);
  assert.equal(DEFAULT_VISUAL_THEME, "minimal");
});

test("theme preferences are read safely from user metadata", () => {
  assert.equal(
    getVisualThemePreference({ [VISUAL_THEME_METADATA_KEY]: "finance" }),
    "finance"
  );
  assert.equal(getVisualThemePreference({ [VISUAL_THEME_METADATA_KEY]: "invalid" }), null);
  assert.equal(getVisualThemePreference(null), null);
  assert.equal(getColorModePreference({ [COLOR_MODE_METADATA_KEY]: "light" }), "light");
  assert.equal(getColorModePreference({ [COLOR_MODE_METADATA_KEY]: 42 }), null);
});

test("theme metadata patches contain only requested preferences", () => {
  assert.deepEqual(buildThemeMetadata({ visualTheme: "classic" }), {
    [VISUAL_THEME_METADATA_KEY]: "classic",
  });
  assert.deepEqual(buildThemeMetadata({ colorMode: "dark" }), {
    [COLOR_MODE_METADATA_KEY]: "dark",
  });
  assert.deepEqual(buildThemeMetadata({ visualTheme: "ledger", colorMode: "light" }), {
    [VISUAL_THEME_METADATA_KEY]: "ledger",
    [COLOR_MODE_METADATA_KEY]: "light",
  });
});
