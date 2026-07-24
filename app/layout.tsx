import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JDE ERP — Jai Durga Enterprises",
  description: "Cloud-based ERP for spare parts business — Inventory, Sales, Purchases, Finance & Analytics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
