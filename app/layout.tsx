import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Providers from "@/components/Providers";
import ConditionalShell from "@/components/ConditionalShell";
import SwRegistrar from "@/components/SwRegistrar";
import Analytics from "@/components/Analytics";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.drivepasscol.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "DrivePass | Alquiler de Carros en Medellín — Entre Particulares",
    template: "%s | DrivePass Medellín",
  },
  description:
    "Alquila carros baratos en Medellín directamente entre particulares. Sedanes, SUVs, camionetas y más. Sin intermediarios, con seguro incluido. ¡Reserva hoy!",
  keywords: [
    "alquiler de carros Medellín",
    "renta de carros Medellín",
    "alquilar carro Medellín barato",
    "arriendo de carros Medellín",
    "carros en alquiler Medellín",
    "alquiler de vehículos Medellín",
    "DrivePass",
    "rent car Medellín",
    "alquiler carro entre particulares Colombia",
    "alquiler carro Antioquia",
    "alquilar SUV Medellín",
    "alquiler carro económico Medellín",
  ],
  authors: [{ name: "DrivePass", url: BASE_URL }],
  creator: "DrivePass",
  publisher: "DrivePass",
  openGraph: {
    type: "website",
    locale: "es_CO",
    url: BASE_URL,
    siteName: "DrivePass",
    title: "DrivePass | Alquiler de Carros en Medellín",
    description:
      "Alquila carros en Medellín directamente entre particulares. Sin intermediarios, precios justos y seguro incluido.",
    images: [{ url: "/brand/og-image.jpg", width: 1200, height: 630, alt: "DrivePass — Alquiler de Carros en Medellín" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DrivePass | Alquiler de Carros en Medellín",
    description: "Alquila carros en Medellín directamente entre particulares. Precios justos, seguro incluido.",
    images: ["/brand/og-image.jpg"],
  },
  alternates: {
    canonical: BASE_URL,
    languages: { "es-CO": BASE_URL },
  },
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
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  verification: {
    google: "sxfV0ysAXWAajHnOSDSGEchxqNCRPgMQbNRXfzHlG2s",
  },
};

export const viewport: Viewport = {
  themeColor: "#1B3356",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${BASE_URL}/#business`,
  name: "DrivePass",
  alternateName: "DrivePass Medellín",
  description: "Plataforma de alquiler de carros entre particulares en Medellín, Colombia.",
  url: BASE_URL,
  logo: `${BASE_URL}/brand/logo-mark.svg`,
  image: `${BASE_URL}/brand/og-image.jpg`,
  telephone: "+57-300-0000000",
  email: "hola@drivepass.com.co",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Medellín",
    addressLocality: "Medellín",
    addressRegion: "Antioquia",
    postalCode: "050001",
    addressCountry: "CO",
  },
  geo: { "@type": "GeoCoordinates", latitude: 6.2442, longitude: -75.5812 },
  areaServed: [
    { "@type": "City", name: "Medellín" },
    { "@type": "AdministrativeArea", name: "Antioquia" },
  ],
  priceRange: "$$",
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
    opens: "00:00",
    closes: "23:59",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface">
        <Analytics />
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
