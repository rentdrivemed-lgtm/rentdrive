import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Providers from "@/components/Providers";
import ConditionalShell from "@/components/ConditionalShell";
import SwRegistrar from "@/components/SwRegistrar";

export const metadata: Metadata = {
  title: "DrivePass Medellín",
  description: "Tu ciudad. Tu ritmo. Tu DrivePass.",
  // Favicon vía URL versionada (?v=3) para forzar refresco y evitar la caché de favicon del navegador.
  icons: {
    icon: [{ url: "/brand/logo-mark.svg?v=3", type: "image/svg+xml" }],
    shortcut: ["/brand/logo-mark.svg?v=3"],
    apple: [{ url: "/icons/apple-touch-icon.png?v=3" }],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DrivePass",
  },
};

export const viewport: Viewport = {
  themeColor: "#1B3356",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-surface">
        <Providers>
          <SwRegistrar />
          <ConditionalShell>
            {children}
          </ConditionalShell>
        </Providers>
      </body>
    </html>
  );
}
