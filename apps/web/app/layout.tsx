import type { ReactNode } from "react";

export const metadata = {
  title: "TOP Procurement",
  description: "AI-платформа управления закупками",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
