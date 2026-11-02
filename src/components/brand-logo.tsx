import Image from "next/image";

export function BrandLogo({
  footer = false,
  href = "#inicio",
}: {
  footer?: boolean;
  href?: string;
}) {
  return (
    <a
      className={`brand${footer ? " footer-brand" : ""}`}
      href={href}
      aria-label="TurnosMerivo, inicio"
    >
      <Image
        className="brand-logo"
        src="/brand/merivo-logo.png"
        alt="Merivo, diamante rojo y nombre dorado"
        width={150}
        height={150}
        unoptimized
        priority={!footer}
      />
      <span className="brand-name">
        Turnos<span className="brand-light">Merivo</span>
        <span className="brand-dot">.</span>
      </span>
    </a>
  );
}
