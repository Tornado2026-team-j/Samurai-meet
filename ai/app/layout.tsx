import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Samurai Meet AI service",
  description: "Internal AI API routes",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans JP', sans-serif",
          lineHeight: 1.6,
          color: "#1c1d23",
          background: "#f6f5f1",
        }}
      >
        {children}
      </body>
    </html>
  );
}
