"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

export async function getClientAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();

  return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};
}

export async function fetchClientJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
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
}
