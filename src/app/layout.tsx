import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const font = IBM_Plex_Sans_Thai({
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ระบบสอบ MEQ ออนไลน์",
  description: "การสอบแบบ Modified Essay Question (MEQ) ออนไลน์",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={font.className}>
      <body>{children}</body>
    </html>
  );
}
