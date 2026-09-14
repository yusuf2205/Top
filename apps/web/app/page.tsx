import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-center">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <h1>TOP Procurement</h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          AI-платформа управления закупками
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <Link href="/login" className="btn">
            Войти
          </Link>
          <Link href="/register" className="btn btn-secondary" style={{ width: "100%" }}>
            Создать организацию
          </Link>
        </div>
      </div>
    </main>
  );
}
