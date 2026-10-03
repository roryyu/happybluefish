import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "周易灵签 · 六十四卦抽签",
  description:
    "通行本《周易》六十四卦抽签：默念所问轻叩灵签，查看卦象、卦辞象辞，并可请解签师解读卦义与启示。",
};

export default function GuaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}