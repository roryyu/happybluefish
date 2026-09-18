import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "郁辰磊 | 技术经理 · AI应用架构师",
  description: "15年+前后端研发经验，8年技术团队管理经验，AI Agent技术专家",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
