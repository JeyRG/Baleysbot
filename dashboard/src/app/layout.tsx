import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

import { LoadingScreen } from "@/components/LoadingScreen";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Admin Panel | Gestión Híbrida WhatsApp",
  description: "Dashboard premium para la gestión de conversaciones de WhatsApp con IA y soporte multimedia.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="scroll-smooth" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${outfit.variable} font-sans antialiased bg-background text-foreground overflow-hidden`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <LoadingScreen />
          <div className="relative min-h-screen flex flex-col">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
