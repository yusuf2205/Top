"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";

/**
 * Client-side gate: the access token lives only in memory (see api-client.ts),
 * so this is a UX convenience (avoid flashing protected content, redirect
 * promptly), not the security boundary — the API itself is what actually
 * enforces authorization on every request (JwtAuthGuard/TenantGuard/RolesGuard).
 * A user who edits the URL directly still can't get data they aren't
 * authorized for; they'd just see a loading state then get redirected here.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
