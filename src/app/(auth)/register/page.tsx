"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabaseBrowser().auth.signUp({ email, password });
    if (error) setError(error.message);
    else {
      router.replace("/families");
      router.refresh();
      window.setTimeout(() => {
        window.location.assign("/families");
      }, 150);
    }
  };

  return (
    <main className="min-h-screen bg-sand-50 flex items-center justify-center px-4">
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-md card p-6 space-y-6">
        <div>
          <p className="text-sm text-slate-500">HomeFund</p>
          <h1 className="text-2xl font-semibold">Create account</h1>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn btn-primary w-full">Register</button>
        </form>
        <p className="text-sm text-slate-600">Have an account? <Link href="/login" className="text-emerald-700">Login</Link></p>
      </div>
    </main>
  );
}
