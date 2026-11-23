"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { error } = await supabaseBrowser().auth.signUp({ email, password });
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
        <p className="page-kicker">Get started</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Create your HomeFund account</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Set up your access and continue to your family workspace.</p>
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
          Create account
        </button>
      </form>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-700 dark:text-emerald-300">
          Log in
        </Link>
      </p>
    </main>
  );
}
