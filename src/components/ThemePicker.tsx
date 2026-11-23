"use client";

import { useState } from "react";
import { AppDialog } from "@/components/AppDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/context/ThemeContext";
import { VISUAL_THEMES } from "@/lib/theme-preferences";

type ThemePickerProps = {
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
};

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.35a1.65 1.65 0 0 0 1.13-2.85 1.62 1.62 0 0 1 1.1-2.8H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.9 16.7 3.5 12 3.5Z" />
      <circle cx="7.7" cy="10.2" r=".8" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="7.3" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14.1" cy="7.5" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThemePreview({ themeId }: { themeId: string }) {
  return (
    <span className="theme-preview" data-preview-theme={themeId} aria-hidden="true">
      <span className="theme-preview-rail">
        <span />
        <span />
        <span />
      </span>
      <span className="theme-preview-canvas">
        <span className="theme-preview-heading" />
        <span className="theme-preview-cards">
          <span />
          <span />
          <span />
        </span>
        <span className="theme-preview-chart"><span /></span>
      </span>
    </span>
  );
}

export function ThemePicker({ compact = false, iconOnly = false, className = "" }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const {
    visualTheme,
    setVisualTheme,
    isSavingPreference,
    preferenceError,
    preferenceScope,
    clearPreferenceError,
  } = useTheme();

  return (
    <>
      <button
        type="button"
        className={`theme-picker-trigger btn btn-ghost ${compact ? "px-3 py-2 text-xs" : "text-sm"} ${className}`}
        aria-label={iconOnly ? "Choose appearance" : undefined}
        title="Choose appearance"
        data-theme-picker-trigger
        onClick={() => {
          clearPreferenceError();
          setOpen(true);
        }}
      >
        <span className="inline-flex h-5 w-5 items-center justify-center"><PaletteIcon /></span>
        {!iconOnly && "Appearance"}
      </button>

      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Choose your theme"
        subtitle="Appearance"
        maxWidthClassName="max-w-2xl"
      >
        <div className="theme-picker-grid" role="radiogroup" aria-label="Visual theme">
          {VISUAL_THEMES.map((option) => {
            const selected = option.id === visualTheme;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="theme-option"
                data-selected={selected ? "true" : "false"}
                onClick={() => setVisualTheme(option.id)}
              >
                <ThemePreview themeId={option.id} />
                <span className="theme-option-copy">
                  <span className="theme-option-name">
                    {option.name}
                    {selected && <span className="theme-option-check" aria-hidden="true">✓</span>}
                  </span>
                  <span className="theme-option-description">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="theme-picker-footer">
          <div>
            <p className="theme-picker-status" role="status" aria-live="polite">
              {preferenceError
                ? preferenceError
                : isSavingPreference
                  ? "Saving to your account…"
                  : preferenceScope === "account"
                    ? "Saved to your HomeFund account."
                    : "Saved on this device until you sign in."}
            </p>
            <p className="theme-picker-hint">Your data, calculations and features stay exactly the same.</p>
          </div>
          <ThemeToggle compact />
        </div>
      </AppDialog>
    </>
  );
}
