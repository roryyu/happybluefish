import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HappyBlueFish",
  description: "HappyBlueFish",
};

export default function BaziLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
