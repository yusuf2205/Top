"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { REALTIME_EVENT_NAME, type DomainEvent } from "@top/types";
import { getAccessToken } from "./api-client";
import { useAuth } from "./auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Realtime Foundation client. Server-push only — this app never emits, never
 * asks to join a room (the server derives `org:<organizationId>` from the
 * verified JWT at handshake time; there is no client-controlled room API).
 * `auth` is a function, not a plain object, so socket.io-client calls it
 * again on every (re)connection attempt — the in-memory access token can
 * rotate between connects (see api-client.ts's refresh flow), and a stale
 * token captured once at mount time would eventually fail the handshake.
 *
 * Best-effort delivery, same honesty as the backend: no replay buffer, no
 * "missed events" catch-up. A reconnect only tells consumers "go refetch
 * REST now", never "here's what you missed" (see useRealtimeReconnect).
 */
interface RealtimeContextValue {
  /** Fires for every domain event this organization's socket receives. Returns an unsubscribe function. */
  addEventListener: (fn: (evt: DomainEvent) => void) => () => void;
  /** Fires only on an actual reconnect (never on the first connect) — the signal to refetch current REST state. */
  addReconnectListener: (fn: () => void) => () => void;
  /** True while the socket is actually connected. Purely informational — no feature may depend on this being true (Phase A/B: the app must work through REST regardless). */
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const eventListenersRef = useRef(new Set<(evt: DomainEvent) => void>());
  const reconnectListenersRef = useRef(new Set<() => void>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return; // no session yet (or logged out) — nothing to connect for

    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on(REALTIME_EVENT_NAME, (evt: DomainEvent) => {
      for (const fn of eventListenersRef.current) fn(evt);
    });
    socket.io.on("reconnect", () => {
      for (const fn of reconnectListenersRef.current) fn();
    });

    return () => {
      socket.close();
      socketRef.current = null;
      setConnected(false);
    };
    // Reconnect the socket if the identity of the logged-in user changes
    // (login/logout) — not on every render, and not on token refresh (the
    // `auth` callback above already re-reads the latest token per attempt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      addEventListener: (fn) => {
        eventListenersRef.current.add(fn);
        return () => eventListenersRef.current.delete(fn);
      },
      addReconnectListener: (fn) => {
        reconnectListenersRef.current.add(fn);
        return () => reconnectListenersRef.current.delete(fn);
      },
      connected,
    }),
    [connected]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime hooks must be used within <RealtimeProvider>");
  return ctx;
}

/**
 * Subscribes to every domain event for the current organization. Socket
 * failure/disconnection is silently tolerated — the page must keep working
 * through REST regardless (Phase A §39); this hook simply never fires if
 * there is no live connection.
 */
export function useRealtimeEvent(handler: (evt: DomainEvent) => void): void {
  const { addEventListener } = useRealtimeContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => addEventListener((evt) => handlerRef.current(evt)), [addEventListener]);
}

/** Fires only on an actual reconnect — the one signal this foundation gives for "you may have missed something, go refetch." */
export function useRealtimeReconnect(handler: () => void): void {
  const { addReconnectListener } = useRealtimeContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => addReconnectListener(() => handlerRef.current()), [addReconnectListener]);
}

/** Purely informational connection status for a small UI indicator (AppShell). Never gate a feature on this. */
export function useRealtimeStatus(): boolean {
  return useRealtimeContext().connected;
}
