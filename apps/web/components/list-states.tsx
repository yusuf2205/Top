import type { ReactNode } from "react";

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state">
      <div className="form-error" style={{ display: "inline-block" }}>
        Что-то пошло не так{message ? `: ${message}` : ""}
      </div>
      <div>
        <button type="button" className="btn btn-secondary" style={{ width: "auto", marginTop: "0.75rem" }} onClick={onRetry}>
          Повторить
        </button>
      </div>
    </div>
  );
}
