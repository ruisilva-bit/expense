"use client";
import { inviteMember } from "@/app/actions/accounts";
import { useTransition, useState } from "react";

export function AccountInviteForm({ accountId }: { accountId: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    start(async () => {
      try {
        await inviteMember(accountId, email);
        setSuccess("Invite sent (user added if exists)");
        setEmail("");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to invite";
        setError(message);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="label">Invite by email</label>
      <div className="flex gap-2">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" required />
        <button className="btn btn-primary whitespace-nowrap" disabled={pending}>{pending ? "Sending..." : "Invite"}</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}
    </form>
  );
}
