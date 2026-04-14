"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const handle = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  };
  return (
    <button onClick={handle} className="btn btn-ghost text-sm">Sign out</button>
  );
}
