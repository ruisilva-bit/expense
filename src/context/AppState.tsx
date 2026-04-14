"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

type User = { id: string; email?: string | null };
type Family = { id: string; name: string; role?: string | null };
type BankAccount = {
  id: string;
  name: string;
  balance: number;
  visible_user_ids?: string[];
  owner_user_ids?: string[];
};

type AppState = {
  user: User | null;
  families: Family[];
  accounts: BankAccount[];
  familiesError: string | null;
  selectedFamily: Family | null;
  selectedAccount: BankAccount | null;
  isAuthLoading: boolean;
  isFamiliesLoading: boolean;
  isAccountsLoading: boolean;
  setSelectedFamily: (f: Family | null) => void;
  setSelectedAccount: (a: BankAccount | null) => void;
  refresh: () => void;
  refreshFamilies: () => void;
};

const Context = createContext<AppState | undefined>(undefined);

const SELECTED_FAMILY_KEY = "expense:selected-family";
const SELECTED_ACCOUNT_KEY = "expense:selected-account";
const MAIN_ACCOUNT_BY_FAMILY_KEY = "expense:main-account-by-family";

const readMainAccountMap = (): Record<string, string> => {
  if (typeof window === "undefined") return {};

  const raw = window.localStorage.getItem(MAIN_ACCOUNT_BY_FAMILY_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && !!entry[1]
      )
    );
  } catch {
    return {};
  }
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const supabase = supabaseBrowser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};
};

const fetchJson = async <T,>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
};

const fetchFamilies = async () => {
  const headers = await getAuthHeaders();
  const payload = await fetchJson<{ families?: Family[]; error?: string }>("/api/families", {
    method: "GET",
    headers,
  });
  return payload.families ?? [];
};

const fetchAccounts = async (familyId: string) => {
  const headers = await getAuthHeaders();
  const payload = await fetchJson<{ accounts?: BankAccount[]; error?: string }>(
    `/api/bank-accounts?familyId=${encodeURIComponent(familyId)}`,
    {
      method: "GET",
      headers,
    }
  );
  return payload.accounts ?? [];
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(SELECTED_FAMILY_KEY);
  });
  const [legacySelectedAccountId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(SELECTED_ACCOUNT_KEY);
  });
  const [mainAccountByFamily, setMainAccountByFamily] = useState<Record<string, string>>(() => readMainAccountMap());

  const { data: families = [], isLoading: isFamiliesLoading, error: familiesError, mutate: mutateFamilies } = useSWR<Family[]>(
    user?.id ? `families:${user.id}` : null,
    () => fetchFamilies(),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const selectedFamily = useMemo<Family | null>(() => {
    if (!families.length) return null;
    if (!selectedFamilyId) return families[0];
    return families.find((family) => family.id === selectedFamilyId) ?? families[0];
  }, [families, selectedFamilyId]);

  const activeFamilyId = selectedFamily?.id ?? null;

  const { data: accounts = [], isLoading: isAccountsLoading, mutate: mutateAccounts } = useSWR<BankAccount[]>(
    activeFamilyId ? `accounts:${activeFamilyId}` : null,
    (key: string) => fetchAccounts(key.split(":")[1] ?? ""),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const selectedAccountId = activeFamilyId
    ? mainAccountByFamily[activeFamilyId] ?? legacySelectedAccountId ?? null
    : null;

  const selectedAccount = useMemo<BankAccount | null>(() => {
    if (!accounts.length) return null;
    if (!selectedAccountId) return accounts[0];
    return accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      setUser(
        session?.user
          ? {
              id: session.user.id,
              email: session.user.email,
            }
          : null
      );
      if (!session?.user) {
        setSelectedFamilyId(null);
        setMainAccountByFamily({});
      }
      setIsAuthLoading(false);
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(
        session?.user
          ? {
              id: session.user.id,
              email: session.user.email,
            }
          : null
      );
      if (!session?.user) {
        setSelectedFamilyId(null);
        setMainAccountByFamily({});
      }
      setIsAuthLoading(false);
      void mutateFamilies();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [mutateFamilies, supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selectedFamily?.id) {
      window.localStorage.setItem(SELECTED_FAMILY_KEY, selectedFamily.id);
      return;
    }

    window.localStorage.removeItem(SELECTED_FAMILY_KEY);
  }, [selectedFamily]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(MAIN_ACCOUNT_BY_FAMILY_KEY, JSON.stringify(mainAccountByFamily));
  }, [mainAccountByFamily]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedAccount?.id) {
      window.localStorage.removeItem(SELECTED_ACCOUNT_KEY);
      return;
    }
    // Keep legacy key synced to preserve compatibility with existing sessions.
    window.localStorage.setItem(SELECTED_ACCOUNT_KEY, selectedAccount.id);
  }, [selectedAccount?.id]);

  const refresh = () => {
    void mutateFamilies();
    void mutateAccounts();
  };

  return (
    <Context.Provider
      value={{
        user,
        families,
        accounts,
        familiesError: familiesError instanceof Error ? familiesError.message : null,
        selectedFamily,
        selectedAccount,
        isAuthLoading,
        isFamiliesLoading,
        isAccountsLoading,
        setSelectedFamily: (family) => {
          setSelectedFamilyId(family?.id ?? null);
        },
        setSelectedAccount: (account) => {
          if (!activeFamilyId) return;
          setMainAccountByFamily((current) => {
            const next = { ...current };
            if (!account?.id) {
              delete next[activeFamilyId];
            } else {
              next[activeFamilyId] = account.id;
            }
            return next;
          });
        },
        refresh,
        refreshFamilies: () => {
          void mutateFamilies();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useAppState = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
};
