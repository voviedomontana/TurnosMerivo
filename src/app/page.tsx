import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  Clock3,
  Scissors,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";

const features = [
  {
    number: "01",
    icon: CalendarDays,
    title: "Una agenda, todo en orden.",
    description:
      "Turnos, horarios y disponibilidad en un mismo lugar. Menos mensajes de ida y vuelta, más claridad para tu día.",
  },
  {
    number: "02",
    icon: Users,
    title: "Tu equipo, en sintonía.",
    description:
      "Un espacio para organizar profesionales y servicios, respetando la forma de trabajar de cada barbería.",
  },
  {
    number: "03",
    icon: ChartNoAxesCombined,
    title: "Conocé mejor tu negocio.",
    description:
      "Información simple sobre la actividad de tu barbería para acompañar tus próximas decisiones.",
  },
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header shell">
        <BrandLogo />
        <nav aria-label="Navegación principal">
          <a className="nav-link" href="#funcionalidades">
            La plataforma
          </a>
          <a className="nav-link" href="#proyecto">
            El proyecto
          </a>
          <a className="nav-link" href="/login">
            Ingresar
          </a>
        </nav>
        <span className="status">
          <span />
          En desarrollo
        </span>
      </header>
      <main id="contenido">
        <section
          className="hero shell"
          id="inicio"
          aria-labelledby="hero-title"
        >
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-line" /> PENSADO PARA BARBERÍAS
            </p>
            <h1 id="hero-title">
              <span className="hero-highlight">Tu oficio merece</span> <br />
              toda tu atención<span className="brand-dot">.</span>
            </h1>
            <p className="hero-subtitle">
              Nosotros nos ocupamos de los turnos.
            </p>
            <p className="hero-description">
              Estamos creando TurnosMerivo: una plataforma simple para organizar
              tu barbería y recuperar tiempo para lo que mejor sabés hacer.
            </p>
            <div className="hero-actions">
              <Button asChild>
                <a href="#funcionalidades">
                  Conocé la plataforma <ArrowRight aria-hidden="true" />
                </a>
              </Button>
              <span className="soon">
                <Clock3 size={15} aria-hidden="true" /> Próximamente
              </span>
            </div>
            <div className="hero-note">
              <span className="note-rule" />
              <p>
                Menos administración.
                <br />
                <strong>Más tiempo detrás de la silla.</strong>
              </p>
            </div>
          </div>
          <div
            className="visual"
            aria-label="Ilustración conceptual de la organización de una barbería. No es una agenda funcional."
          >
            <div className="visual-top">
              <span>EL DÍA, EN SU LUGAR</span>
              <span className="visual-edition">MERIVO / TURNOS</span>
            </div>
            <Image
              className="visual-logo"
              src="/brand/merivo-logo.png"
              alt="Logo Merivo"
              width={150}
              height={150}
              unoptimized
              priority
            />
            <div className="visual-heading">
              Un buen corte empieza
              <br />
              con un día organizado.
            </div>
            <div className="concept-card">
              <div className="concept-header">
                <div className="concept-icon">
                  <CalendarDays size={21} aria-hidden="true" />
                </div>
                <div>
                  <strong>Tu próxima agenda</strong>
                  <p>Una vista de lo que viene</p>
                </div>
                <span className="concept-dots" aria-hidden="true">
                  •••
                </span>
              </div>
              <div className="concept-row">
                <span className="row-icon">
                  <Scissors size={17} aria-hidden="true" />
                </span>
                <div>
                  <strong>Servicios a tu medida</strong>
                  <p>Cada detalle, en su lugar</p>
                </div>
                <Check size={17} aria-hidden="true" />
              </div>
              <div className="concept-row">
                <span className="row-icon">
                  <Users size={17} aria-hidden="true" />
                </span>
                <div>
                  <strong>Un equipo conectado</strong>
                  <p>Todos mirando hacia el mismo lado</p>
                </div>
                <Check size={17} aria-hidden="true" />
              </div>
              <div className="concept-bottom">
                <span className="small-dot" /> Menos vueltas. Más oficio.
              </div>
            </div>
            <div className="visual-footer">
              <span>TURNOSMERIVO</span>
              <span>CONCEPTO · VISTA ILUSTRATIVA</span>
            </div>
          </div>
        </section>
        <div className="section-divider shell">
          <span>UNA FORMA MÁS SIMPLE DE ORGANIZARTE</span>
          <ArrowDown size={16} aria-hidden="true" />
        </div>
        <section
          id="funcionalidades"
          className="features shell"
          aria-labelledby="features-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">LO QUE ESTAMOS CONSTRUYENDO</p>
              <h2 id="features-title">
                Todo conectado. <br />
                Todo más simple.
              </h2>
            </div>
            <p>
              Las herramientas que tu barbería necesita,
              <br className="desktop-break" /> con la simpleza que tu día
              merece.
            </p>
          </div>
          <div className="feature-grid">
            {features.map(({ number, icon: Icon, title, description }) => (
              <article className="feature" key={number}>
                <div className="feature-top">
                  <Icon size={25} strokeWidth={1.5} aria-hidden="true" />
                  <span>/{number}</span>
                </div>
                <span className="future-label">PRÓXIMAMENTE</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          className="project shell"
          id="proyecto"
          aria-labelledby="project-title"
        >
          <div className="project-inner">
            <div>
              <p className="eyebrow">
                <span className="small-dot" /> EL PRIMER PASO
              </p>
              <h2 id="project-title">
                Las buenas cosas
                <br />
                se construyen con tiempo.
              </h2>
              <p>
                TurnosMerivo está en desarrollo. Hoy estamos preparando la base;
                las reservas y las herramientas de gestión llegarán en próximas
                etapas.
              </p>
            </div>
            <div className="project-state">
              <span className="phase-number">
                00<span>/</span>
              </span>
              <strong>La base de lo que viene</strong>
              <span>Etapa inicial · Proyecto en desarrollo</span>
              <div className="progress-track" aria-hidden="true">
                <span />
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer shell">
        <BrandLogo footer />
        <p>Hecho para acompañar tu oficio.</p>
        <span>Una nueva etapa, próximamente.</span>
      </footer>
    </>
  );
}
