"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handle = async () => {
    setIsPending(true);
    try {
      await Promise.race([
        supabaseBrowser().auth.signOut(),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    } catch {
      try {
        await supabaseBrowser().auth.signOut({ scope: "local" });
      } catch {
        // Ignore network errors and continue local logout UX.
      }
    }

    window.localStorage.removeItem("expense:selected-family");
    window.localStorage.removeItem("expense:selected-account");
    window.localStorage.removeItem("expense:main-account-by-family");

    router.replace("/login");
    router.refresh();
    // Route refresh can lag in some browsers; force navigation as a final fallback.
    window.setTimeout(() => {
      window.location.assign("/login");
    }, 250);
  };

  return (
    <button onClick={handle} className="btn btn-ghost text-sm" type="button" disabled={isPending}>
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
