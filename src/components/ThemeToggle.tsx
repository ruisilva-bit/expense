"use client";

import { useTheme } from "@/context/ThemeContext";
import { useSyncExternalStore } from "react";

type Props = {
  compact?: boolean;
  className?: string;
};

export function ThemeToggle({ compact = false, className = "" }: Props) {
  const { theme, toggleTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const isDark = theme === "dark";
  const label = hydrated ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`btn btn-ghost border border-slate-200 ${compact ? "px-3 py-1.5 text-xs" : "text-sm"} ${className}`}
      aria-label={label}
      title={label}
    >
      <span className="mr-2" aria-hidden="true">
        {hydrated ? (isDark ? "🌙" : "☀️") : "🌓"}
      </span>
      {hydrated ? (isDark ? "Dark" : "Light") : "Theme"}
    </button>
  );
}
