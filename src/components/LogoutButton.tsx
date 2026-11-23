"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

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
    window.setTimeout(() => {
      window.location.assign("/login");
    }, 250);
  };

  return (
    <button onClick={handle} className="btn btn-ghost w-full justify-start text-sm" type="button" disabled={isPending}>
      <span className="inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M10 6V4.75A1.75 1.75 0 0 1 11.75 3h5.5A1.75 1.75 0 0 1 19 4.75v14.5A1.75 1.75 0 0 1 17.25 21h-5.5A1.75 1.75 0 0 1 10 19.25V18" />
          <path d="M14 12H4.5" />
          <path d="m7.5 9-3 3 3 3" />
        </svg>
      </span>
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
