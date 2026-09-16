"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one generic modal primitive in the app (there was none before Web UI
 * Phase A). Reused by every PR action dialog (assign buyer / reject / cancel)
 * instead of each building its own.
 *
 * Phase B focus hardening (Phase A explicitly reported no focus management):
 * on open, focus moves into the dialog; Tab/Shift+Tab is trapped inside it
 * so the page behind it never receives focus while it's open; on close,
 * focus returns to whatever element opened the dialog. This is a small,
 * dependency-free DOM-level implementation — not a full a11y library — kept
 * deliberately simple rather than risking a fragile framework integration.
 */
export function Dialog({
  title,
  onClose,
  children,
  closeDisabled,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** While true (a mutation is in flight), Escape and backdrop-click do nothing — closing mid-request would abandon the in-flight call with no way to tell whether it succeeded. The dialog's own submit button remains the only way out until it settles. */
  closeDisabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;

    const focusable = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? containerRef.current)?.focus();

    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!closeDisabled) onClose();
        return;
      }
      if (e.key !== "Tab" || !containerRef.current) return;

      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, closeDisabled]);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={containerRef}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
