"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_VISUAL_THEME,
  THEME_COLOR_BY_VARIANT,
  VISUAL_THEME_STORAGE_KEY,
  buildThemeMetadata,
  getColorModePreference,
  getVisualThemePreference,
  isColorMode,
  isVisualTheme,
  type ColorMode,
  type VisualThemeId,
} from "@/lib/theme-preferences";

export type ThemePreferenceScope = "account" | "device";

type ThemeContextValue = {
  theme: ColorMode;
  visualTheme: VisualThemeId;
  setTheme: (theme: ColorMode) => void;
  setVisualTheme: (theme: VisualThemeId) => void;
  toggleTheme: () => void;
  isSavingPreference: boolean;
  preferenceError: string | null;
  preferenceScope: ThemePreferenceScope;
  clearPreferenceError: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getInitialColorMode = (): ColorMode => {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  if (isColorMode(saved)) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const getInitialVisualTheme = (): VisualThemeId => {
  if (typeof window === "undefined") return DEFAULT_VISUAL_THEME;
  const saved = window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY);
  return isVisualTheme(saved) ? saved : DEFAULT_VISUAL_THEME;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [theme, setThemeState] = useState<ColorMode>(getInitialColorMode);
  const [visualTheme, setVisualThemeState] = useState<VisualThemeId>(getInitialVisualTheme);
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncFromUser = useCallback((user: User | null) => {
    if (!user) {
      setAccountUserId(null);
      return;
    }

    setAccountUserId(user.id);
    setVisualThemeState(getVisualThemePreference(user.user_metadata) ?? DEFAULT_VISUAL_THEME);

    const savedColorMode = getColorModePreference(user.user_metadata);
    if (savedColorMode) setThemeState(savedColorMode);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      const {
        data: { session },
      } = (await supabase.auth.getSession()) as { data: { session: Session | null } };
      if (!cancelled) syncFromUser(session?.user ?? null);
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        syncFromUser(null);
        return;
      }

      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        syncFromUser(session?.user ?? null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, syncFromUser]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.visualTheme = visualTheme;
    root.style.colorScheme = theme;
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, theme);
    window.localStorage.setItem(VISUAL_THEME_STORAGE_KEY, visualTheme);

    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = THEME_COLOR_BY_VARIANT[visualTheme][theme];
    });
  }, [theme, visualTheme]);

  const persistMetadata = useCallback(
    (metadata: Record<string, string>) => {
      if (!accountUserId) {
        setPreferenceError(null);
        return;
      }

      const version = ++saveVersionRef.current;
      setIsSavingPreference(true);
      setPreferenceError(null);

      const writePreference = async () => {
        const { data, error } = await supabase.auth.updateUser({ data: metadata });
        if (error) throw error;

        const savedMetadata = data.user?.user_metadata;
        const confirmed = Object.entries(metadata).every(
          ([key, value]) => savedMetadata?.[key] === value
        );
        if (!confirmed) throw new Error("HomeFund could not confirm your appearance preference.");
      };

      saveQueueRef.current = saveQueueRef.current.then(writePreference, writePreference).then(
        () => {
          if (!mountedRef.current || version !== saveVersionRef.current) return;
          setIsSavingPreference(false);
        },
        (error: unknown) => {
          if (!mountedRef.current || version !== saveVersionRef.current) return;
          setIsSavingPreference(false);
          setPreferenceError(error instanceof Error ? error.message : "Could not save your appearance preference.");
        }
      );
    },
    [accountUserId, supabase]
  );

  const setTheme = useCallback(
    (nextTheme: ColorMode) => {
      setThemeState(nextTheme);
      persistMetadata(buildThemeMetadata({ colorMode: nextTheme }));
    },
    [persistMetadata]
  );

  const setVisualTheme = useCallback(
    (nextTheme: VisualThemeId) => {
      setVisualThemeState(nextTheme);
      persistMetadata(buildThemeMetadata({ visualTheme: nextTheme }));
    },
    [persistMetadata]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      visualTheme,
      setTheme,
      setVisualTheme,
      toggleTheme,
      isSavingPreference,
      preferenceError,
      preferenceScope: accountUserId ? "account" : "device",
      clearPreferenceError: () => setPreferenceError(null),
    }),
    [
      accountUserId,
      isSavingPreference,
      preferenceError,
      setTheme,
      setVisualTheme,
      theme,
      toggleTheme,
      visualTheme,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
