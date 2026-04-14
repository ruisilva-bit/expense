"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { supabaseBrowser } from "@/lib/supabase-browser";

type User = { id: string; email?: string | null };
type Family = { id: string; name: string; role?: string | null };
type BankAccount = { id: string; name: string; balance: number };
type FamilyMembershipRow = { family_id: string; role?: string | null };

type AppState = {
  user: User | null;
  families: Family[];
  accounts: BankAccount[];
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

const fetchFamilies = async (userId: string) => {
  const supabase = supabaseBrowser();
  const membersRes = await supabase
    .from("family_members")
    .select("family_id, role")
    .eq("user_id", userId);

  if (!membersRes.error) {
    const membershipRows = (membersRes.data as FamilyMembershipRow[] | null) ?? [];
    if (!membershipRows.length) return [];

    const familyIds = membershipRows.map((m) => m.family_id);
    const familiesRes = await supabase.from("families").select("id,name").in("id", familyIds);
    if (familiesRes.error) throw familiesRes.error;

    const byId = new Map((familiesRes.data ?? []).map((family) => [family.id, family.name]));

    return membershipRows.map((membership) => ({
      id: membership.family_id,
      name: byId.get(membership.family_id) ?? "Family",
      role: membership.role ?? null,
    }));
  }

  const fallback = await supabase.from("families").select("id,name").order("created_at", { ascending: false });
  if (fallback.error) throw fallback.error;

  return (fallback.data ?? []).map((family) => ({
    id: family.id,
    name: family.name,
    role: null,
  }));
};

const fetchAccounts = async (familyId: string) => {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id,name,balance")
    .eq("family_id", familyId);
  if (error) throw error;
  return data ?? [];
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);

  const { data: families = [], isLoading: isFamiliesLoading, mutate: mutateFamilies } = useSWR<Family[]>(
    user?.id ? `families:${user.id}` : null,
    (key: string) => fetchFamilies(key.split(":")[1] ?? ""),
    {
      revalidateOnFocus: false,
    }
  );

  const activeFamilyId = selectedFamilyId ?? families[0]?.id ?? null;

  const { data: accounts = [], isLoading: isAccountsLoading, mutate: mutateAccounts } = useSWR<BankAccount[]>(
    activeFamilyId ? `accounts:${activeFamilyId}` : null,
    (key: string) => fetchAccounts(key.split(":")[1] ?? ""),
    {
      revalidateOnFocus: false,
    }
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const selectedFamily = useMemo<Family | null>(() => {
    if (!families.length) return null;
    return families.find((family) => family.id === selectedFamilyId) ?? families[0];
  }, [families, selectedFamilyId]);

  const selectedAccount = useMemo<BankAccount | null>(() => {
    if (!accounts.length) return null;
    return accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedFamilyId = window.localStorage.getItem(SELECTED_FAMILY_KEY);
    const storedAccountId = window.localStorage.getItem(SELECTED_ACCOUNT_KEY);

    if (storedFamilyId) setSelectedFamilyId(storedFamilyId);
    if (storedAccountId) setSelectedAccountId(storedAccountId);
  }, []);

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
      setIsAuthLoading(false);
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(
        session?.user
          ? {
              id: session.user.id,
              email: session.user.email,
            }
          : null
      );
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

    if (selectedAccount?.id) {
      window.localStorage.setItem(SELECTED_ACCOUNT_KEY, selectedAccount.id);
      return;
    }

    window.localStorage.removeItem(SELECTED_ACCOUNT_KEY);
  }, [selectedAccount]);

  useEffect(() => {
    if (!selectedFamilyId || families.some((family) => family.id === selectedFamilyId)) return;
    setSelectedFamilyId(null);
  }, [families, selectedFamilyId]);

  useEffect(() => {
    if (!selectedAccountId || accounts.some((account) => account.id === selectedAccountId)) return;
    setSelectedAccountId(null);
  }, [accounts, selectedAccountId]);

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
        selectedFamily,
        selectedAccount,
        isAuthLoading,
        isFamiliesLoading,
        isAccountsLoading,
        setSelectedFamily: (family) => {
          setSelectedFamilyId(family?.id ?? null);
          setSelectedAccountId(null);
        },
        setSelectedAccount: (a) => setSelectedAccountId(a?.id ?? null),
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
