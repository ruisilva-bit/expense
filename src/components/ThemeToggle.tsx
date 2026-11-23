"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "@/context/ThemeContext";

type Props = {
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
};

export function ThemeToggle({ compact = false, iconOnly = false, className = "" }: Props) {
  const { theme, toggleTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const isDark = theme === "dark";
  const label = hydrated ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme";
  const buttonText = hydrated ? (isDark ? "Dark" : "Light") : "Theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`btn btn-ghost border border-slate-200 ${compact ? "px-3 py-2 text-xs" : "text-sm"} ${className}`}
      aria-label={label}
      title={label}
    >
      <span className="inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        {hydrated && isDark ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2.5M12 19v2.5M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2.5 12H5M19 12h2.5M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
          </svg>
        )}
      </span>
      {!iconOnly && buttonText}
    </button>
  );
}
