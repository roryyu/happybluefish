import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "见好 · 旅行路书",
  description: "一句话旅游想法，生成可照着走的完整旅行路书",
};

export default function TravelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
