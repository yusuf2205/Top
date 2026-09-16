"use client";

import { useEffect, useState } from "react";
import type { OrganizationMember } from "@top/types";
import { api } from "./api-client";

/** Resolves a user id to a display name, or a safe fallback if the member list hasn't loaded or the user is unknown. */
export type MemberLookup = (userId: string) => string;

/**
 * Loads the organization's member list ONCE per page (not per row — see
 * Phase A §35's explicit "avoid N+1" requirement) and exposes a synchronous
 * lookup function. `api.members.list()` is already a flat, unpaginated call
 * (Phase A inventory §12), so a single fetch is enough for any reasonable
 * organization size.
 */
export function useMemberLookup(): MemberLookup {
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);

  useEffect(() => {
    api.members
      .list()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  return (userId: string) => {
    const member = members?.find((m) => m.id === userId);
    if (member) return member.fullName;
    return members === null ? "…" : "Пользователь недоступен";
  };
}
