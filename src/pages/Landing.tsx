import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  FileSearch,
  Scale,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-background text-foreground"
    >
      {/* Nav */}
      <header className="hairline-b sticky top-0 z-10 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight">TalentFlow AI</span>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href="/org">Para empresas</a>
            </Button>
            <Button size="sm" asChild>
              <a href={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
                {isAuthenticated ? "Mi CV y diagnóstico" : "Empezar"}
              </a>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-24 sm:pt-32">
        <motion.p {...fadeUp} className="eyebrow">
          Empleabilidad y recruiting asistidos por IA
        </motion.p>
        <motion.h1
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.05 }}
          className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl"
        >
          Tu CV, leído como un reclutador experto lo leería.
        </motion.h1>
        <motion.p
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.1 }}
          className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground"
        >
          Sube tu CV y recibe un diagnóstico de empleabilidad con oportunidades
          concretas de mejora. Si contratas, evalúa candidatos con match scores
          explicables, requisito por requisito — la decisión final siempre es humana.
        </motion.p>
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.15 }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Button size="lg" asChild>
            <a href={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
              Analizar mi CV
              <ArrowRight className="size-4" />
            </a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="/org">Soy empresa / RH</a>
          </Button>
        </motion.div>
        <motion.p
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.2 }}
          className="mt-6 text-xs text-muted-foreground"
        >
          Análisis asistido por IA · sin promesas de resultados · tus datos no
          entrenan modelos
        </motion.p>
      </section>

      {/* Dos lados */}
      <section className="hairline-t mx-auto max-w-6xl px-6 py-24">
        <motion.p {...fadeUp} className="eyebrow">
          Dos experiencias, un mismo estándar
        </motion.p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
          <motion.div {...fadeUp} className="bg-card p-10">
            <div className="flex size-10 items-center justify-center rounded-md border border-border">
              <UserRound className="size-5" />
            </div>
            <h2 className="mt-6 text-xl font-semibold tracking-tight">
              Para candidatos
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Tu CV estructurado y editable, un diagnóstico por dimensiones y una
              lista clara de qué mejorar para posicionarte mejor.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Extracción automática de experiencia, skills y logros",
                "Diagnóstico determinista: completitud, impacto, skills, narrativa",
                "Historial de versiones de tu CV",
                "Todo editable — la IA propone, tú decides",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {t}
                </li>
              ))}
            </ul>
            <Button className="mt-8" variant="outline" asChild>
              <a href={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
                Ver mi diagnóstico
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className="bg-card p-10"
          >
            <div className="flex size-10 items-center justify-center rounded-md border border-border">
              <Building2 className="size-5" />
            </div>
            <h2 className="mt-6 text-xl font-semibold tracking-tight">
              Para empresas y RH
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Crea tu organización, define requisitos ponderados y evalúa CVs con
              evidencia citada por requisito. Preselección y rechazo con nota, siempre
              con autor humano registrado.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Matching determinista y auditable (sin LLM en el scoring)",
                "Evidencia textual por requisito: qué cumple y qué falta",
                "Roles: org_admin, recruiter, hiring_manager",
                "Historial de decisiones con notas obligatorias al rechazar",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <FileSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {t}
                </li>
              ))}
            </ul>
            <Button className="mt-8" variant="outline" asChild>
              <a href="/org">
                Crear organización
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="hairline-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <motion.p {...fadeUp} className="eyebrow">
            Cómo funciona
          </motion.p>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {[
              {
                n: "01",
                t: "Sube tu CV",
                d: "PDF, DOCX o TXT. Validamos el archivo, extraemos el texto y la IA lo estructura con evidencia y niveles de confianza.",
              },
              {
                n: "02",
                t: "Recibe tu diagnóstico",
                d: "Cuatro dimensiones puntuadas y oportunidades accionables. Sin promesas: señales claras basadas solo en tus datos.",
              },
              {
                n: "03",
                t: "Mejora y comparte",
                d: "Corrige lo que la IA no capturó, activa versiones anteriores y mantén tu perfil siempre listo para la siguiente oportunidad.",
              },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.06 }}
              >
                <p className="text-4xl font-semibold tracking-tight text-muted-foreground/40">
                  {s.n}
                </p>
                <h3 className="mt-4 font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Principios */}
      <section className="hairline-t mx-auto max-w-6xl px-6 py-24">
        <motion.p {...fadeUp} className="eyebrow">
          Nuestros principios
        </motion.p>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          {[
            {
              icon: Scale,
              t: "La IA no decide sobre personas",
              d: "El matching produce recomendaciones con evidencia. Contratar, preseleccionar o rechazar lo decide una persona, con su nombre registrado.",
            },
            {
              icon: ShieldCheck,
              t: "Privado por diseño",
              d: "Multi-tenant con aislamiento estricto entre organizaciones. Archivos en storage privado y datos mínimos en logs.",
            },
            {
              icon: Sparkles,
              t: "Sin promesas vacías",
              d: "Mostramos rangos e indicadores cuando hay datos suficientes. Nunca prometemos aumentos ni resultados garantizados.",
            },
          ].map((p, i) => (
            <motion.div
              key={p.t}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.06 }}
            >
              <p.icon className="size-5 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">{p.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="hairline-t">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <motion.h2
            {...fadeUp}
            className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Empieza con tu CV. El resto se construye desde ahí.
          </motion.h2>
          <motion.div
            {...fadeUp}
            className="mt-8 flex flex-wrap justify-center gap-3"
          >
            <Button size="lg" asChild>
              <a href={isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard"}>
                Crear mi cuenta
              </a>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <a href="/org">Explorar el lado empresa</a>
            </Button>
          </motion.div>
          <p className="mt-8 text-xs text-muted-foreground">
            Al continuar aceptas nuestro análisis asistido por IA. Puedes
            exportar o eliminar tus datos cuando quieras.
          </p>
        </div>
      </section>

      <footer className="hairline-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} TalentFlow AI</span>
          <span>Análisis asistido por IA con revisión humana · v1</span>
        </div>
      </footer>
    </motion.div>
  );
}
