import type { Metadata } from "next";
import { getSupabaseConfig } from "@/lib/supabase/config";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/brand/merivo-logo.png", apple: "/brand/merivo-logo.png" },
  title: "TurnosMerivo | Más tiempo para tu oficio",
  description:
    "Estamos creando una forma más simple de gestionar los turnos de tu barbería. Conocé el proyecto TurnosMerivo.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  getSupabaseConfig();
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
