import type { Metadata } from "next";
import "../src/client/styles.css";

export const metadata: Metadata = {
  title: "Goal Network",
  description: "Goal network management system"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
