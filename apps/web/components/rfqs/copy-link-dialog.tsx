"use client";

import { useState } from "react";
import { Dialog } from "../dialog";

/**
 * M3.4 Phase D §2/§24/§37 — shown once, immediately after Invite/Reissue
 * returns the raw one-time token. The URL is built here (never sent by the
 * backend) as `${origin}/portal/rfq#token=<encoded>` — a URL FRAGMENT, never
 * a query/path segment, so the token never reaches server access logs.
 * Closing this dialog is the only place the raw token is ever shown; the
 * caller must not keep it in state afterward (Phase D §1: "Do not show raw
 * token after the initial issue/reissue response is dismissed").
 *
 * No `navigator.clipboard` dependency needed — it's a standard browser API,
 * not an npm package, so the "Копировать" button here adds zero new
 * dependencies (Phase D §55). Falls back to a manual-select `<code>` block
 * (this repo's existing pattern, `settings/members/page.tsx`) if the
 * Clipboard API throws/is unavailable (e.g. non-secure context).
 */
export function CopyLinkDialog({ token, reissued, onClose }: { token: string; reissued?: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/portal/rfq#token=${encodeURIComponent(token)}` : "";

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <Dialog title="Ссылка для поставщика" onClose={onClose}>
      <p className="muted">
        {reissued
          ? "Старая ссылка перестала работать. Отправьте поставщику новую ссылку ниже — обязательно только её, старая ссылка больше не действительна."
          : "Отправьте эту ссылку поставщику любым удобным способом (email, Telegram, WhatsApp). По ней поставщик сможет посмотреть RFQ и отправить предложение без регистрации в системе."}
      </p>
      <p>
        <code style={{ wordBreak: "break-all" }}>{url}</code>
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCopy}>
          {copied ? "Скопировано" : "Копировать"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Готово
        </button>
      </div>
      {copyFailed && <p className="form-error">Не удалось скопировать автоматически — выделите ссылку вручную.</p>}
    </Dialog>
  );
}
