import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { PhoneApp } from "@/components/phone-app";
export const metadata: Metadata = {
  title: "Nonymauz People · HR workspace",
  description:
    "Your people, everyday work and hiring in one thoughtful workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Nonymauz People",
    statusBarStyle: "default",
  },
  icons: { apple: "/apple-touch-icon.png", icon: "/icon-192.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfb" },
    { media: "(prefers-color-scheme: dark)", color: "#17201f" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <PhoneApp />
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
