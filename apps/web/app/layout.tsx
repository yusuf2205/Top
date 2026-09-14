import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";
import "./globals.css";

export const metadata = {
  title: "TOP Procurement",
  description: "AI-платформа управления закупками",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
