"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/families");
    router.refresh();
    window.setTimeout(() => {
      window.location.assign("/families");
    }, 150);
  };

  return (
    <main className="auth-card">
      <div>
        <p className="page-kicker">Welcome back</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to HomeFund</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Review family finances, balances, and recent activity.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>

        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>

        {error && <p className="status-banner status-banner-error">{error}</p>}

        <button className="btn btn-primary w-full" type="submit">
          Log in
        </button>
      </form>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        No account?{" "}
        <Link href="/register" className="font-semibold text-emerald-700 dark:text-emerald-300">
          Create one
        </Link>
      </p>
    </main>
  );
}
