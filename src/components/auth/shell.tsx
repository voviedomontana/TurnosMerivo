import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { logoutAction } from "@/modules/auth/actions";

export function AccessShell({
  children,
  signedIn = false,
}: {
  children: React.ReactNode;
  signedIn?: boolean;
}) {
  return (
    <div className="product-shell">
      <header className="product-header">
        <BrandLogo href="/" />
        <nav aria-label="Acceso">
          {signedIn ? (
            <>
              <Link href="/app">Mis negocios</Link>
              <Link href="/seguridad">Seguridad</Link>
              <form action={logoutAction}>
                <button className="text-link" type="submit">
                  Salir
                </button>
              </form>
            </>
          ) : (
            <Link href="/">Volver al inicio</Link>
          )}
        </nav>
      </header>
      <main className="product-main" id="contenido">
        {children}
      </main>
      <footer className="product-footer">
        MERIVO <span>Tu negocio. Tu equipo. Un mismo lugar.</span>
      </footer>
    </div>
  );
}
