import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import {
  Briefcase,
  Check,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Pencil,
  Plus,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { CvUpload } from "@/components/CvUpload";

type Profile = Doc<"candidateProfiles">;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative flex size-20 items-center justify-center rounded-full border border-border"
        role="img"
        aria-label={`${label}: ${score} de 100`}
      >
        <span className="text-2xl font-semibold tabular-nums">{score}</span>
        <span className="absolute bottom-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          /100
        </span>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function Dimension({
  label,
  score,
  children,
}: {
  label: string;
  score: number;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm tabular-nums text-muted-foreground">{score}/100</p>
      </div>
      <Progress value={score} className="mt-2 h-1" />
      {children}
    </div>
  );
}

function Diagnóstico({ profile }: { profile: Profile }) {
  const d = profile.diagnosis;
  const scores = [
    { label: "Completitud", value: d?.completeness ?? 0 },
    { label: "Impacto", value: d?.impact ?? 0 },
    { label: "Skills", value: d?.skills ?? 0 },
    { label: "Narrativa", value: d?.narrative ?? 0 },
  ];

  return (
    <section aria-labelledby="diagnosis-title" className="mt-12">
      <div className="hairline-b pb-4">
        <p className="eyebrow">Diagnóstico de empleabilidad</p>
        <h2 id="diagnosis-title" className="mt-1 text-xl font-semibold">
          Dónde estás hoy
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Evaluación determinista sobre tu perfil actual. No es una promesa de
          resultados: son señales de mejora con acciones concretas.
          {!d?.hasSufficientData && " Aún hay pocos datos para algunas métricas."}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {scores.map((s) => (
          <ScoreRing key={s.label} score={s.value} label={s.label} />
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          {scores.map((s) => (
            <Dimension key={s.label} label={s.label} score={s.value}>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.value >= 75
                  ? "Fortaleza actual."
                  : s.value >= 45
                    ? "Rango intermedio: hay margen de mejora."
                    : "Prioridad de mejora."}
              </p>
            </Dimension>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Oportunidades de mejora</h3>
          {d?.opportunities?.length ? (
            <ul className="mt-3 space-y-3">
              {d.opportunities.map((o, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium capitalize">{o.dimension}</p>
                    <p className="mt-0.5 text-muted-foreground">{o.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Sin oportunidades detectadas por ahora: tu perfil cubre lo básico.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SkillsEditor({ profile }: { profile: Profile }) {
  const updateProfile = useMutation(api.candidates.updateProfile);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(3);
  const [busy, setBusy] = useState(false);

  async function addSkill() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await updateProfile({
        skills: [
          ...profile.skills,
          { name: name.trim(), level, source: "human" as const },
        ],
      });
      setName("");
    } finally {
      setBusy(false);
    }
  }

  async function removeSkill(skillName: string) {
    setBusy(true);
    try {
      await updateProfile({
        skills: profile.skills.filter((s) => s.name !== skillName),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {profile.skills.map((s) => (
          <Badge key={s.name} variant="secondary" className="gap-1.5 pr-1">
            {s.name} · L{s.level}
            {s.source === "human" && (
              <span className="text-[10px] text-muted-foreground">(tú)</span>
            )}
            <button
              aria-label={`Quitar ${s.name}`}
              className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
              onClick={() => void removeSkill(s.name)}
              disabled={busy}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {profile.skills.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin skills aún. Añade al menos las 5 principales.
          </p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Añadir skill (ej. SQL)"
          className="h-9 max-w-48"
          onKeyDown={(e) => e.key === "Enter" && void addSkill()}
        />
        <select
          aria-label="Nivel"
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {[1, 2, 3, 4, 5].map((l) => (
            <option key={l} value={l}>
              Nivel {l}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void addSkill()}
          disabled={busy || !name.trim()}
        >
          <Plus className="size-4" />
          Añadir
        </Button>
      </div>
    </div>
  );
}

function BasicsEditor({ profile }: { profile: Profile }) {
  const updateProfile = useMutation(api.candidates.updateProfile);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: profile.fullName ?? "",
    headline: profile.headline ?? "",
    location: profile.location ?? "",
    summary: profile.summary ?? "",
    yearsExperience: String(profile.yearsExperience ?? ""),
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateProfile({
        fullName: form.fullName || undefined,
        headline: form.headline || undefined,
        location: form.location || undefined,
        summary: form.summary || undefined,
        yearsExperience: form.yearsExperience
          ? Number(form.yearsExperience)
          : undefined,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.fullName || "Tu perfil"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile.headline || "Sin titular profesional"}
            {profile.location ? ` · ${profile.location}` : ""}
            {profile.yearsExperience !== undefined
              ? ` · ${profile.yearsExperience} años de experiencia`
              : ""}
          </p>
          {profile.summary && (
            <p className="mt-3 max-w-2xl text-sm leading-6">
              {profile.summary}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          Editar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input
            id="fullName"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="headline">Titular profesional</Label>
          <Input
            id="headline"
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            placeholder="Ej. Analista de datos con 4 años en BI"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="location">Ubicación</Label>
          <Input
            id="location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="years">Años de experiencia</Label>
          <Input
            id="years"
            type="number"
            min={0}
            max={60}
            value={form.yearsExperience}
            onChange={(e) =>
              setForm({ ...form, yearsExperience: e.target.value })
            }
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="summary">Resumen profesional</Label>
        <Textarea
          id="summary"
          rows={3}
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          <Check className="size-4" />
          Guardar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function MiCv({ profile, resumes }: { profile: Profile; resumes: any[] }) {
  return (
    <section aria-labelledby="cv-title" className="mt-12">
      <div className="hairline-b pb-4">
        <p className="eyebrow">Mi CV</p>
        <h2 id="cv-title" className="mt-1 text-xl font-semibold">
          Versión estructurada
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Extraído por IA de tu CV activo y editable por ti. Los datos que
          corriges prevalecen sobre los detectados automáticamente.
        </p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <div className="space-y-8">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Briefcase className="size-4 text-muted-foreground" />
              Experiencia
            </h3>
            <ul className="mt-4 space-y-5">
              {profile.experience.map((e, i) => (
                <li key={i} className="border-l border-border pl-4">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.company} · {e.start}
                    {e.end ? ` – ${e.end}` : e.current ? " – actual" : ""}
                  </p>
                  {e.description && (
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {e.description}
                    </p>
                  )}
                  {e.achievements.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {e.achievements.map((a, j) => (
                        <li key={j} className="flex gap-2 text-sm">
                          <span className="text-muted-foreground">—</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {profile.experience.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Sin experiencia registrada.
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <GraduationCap className="size-4 text-muted-foreground" />
              Educación
            </h3>
            <ul className="mt-4 space-y-3">
              {profile.education.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium">
                    {e.degree}
                    {e.field ? ` — ${e.field}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {e.institution}
                    {e.endYear ? ` · ${e.endYear}` : ""}
                  </p>
                </li>
              ))}
              {profile.education.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Sin educación registrada.
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="size-4 text-muted-foreground" />
              Certificaciones
            </h3>
            <ul className="mt-4 space-y-2">
              {profile.certifications.map((c, i) => (
                <li key={i} className="text-sm">
                  {c.name}
                  {c.issuer ? ` · ${c.issuer}` : ""}
                  {c.year ? ` (${c.year})` : ""}
                </li>
              ))}
              {profile.certifications.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Sin certificaciones registradas.
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Skills</h3>
            <div className="mt-4">
              <SkillsEditor profile={profile} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery(api.candidates.myProfile);
  const resumes = useQuery(api.candidates.myResumes);
  const diagnosis = useQuery(api.candidates.diagnosis);

  const [tab, setTab] = useState<"cv" | "diagnostico">("diagnostico");

  const activeVersions = useMemo(() => {
    if (!resumes) return [];
    return resumes.flatMap((r: any) => r.versions as any[]);
  }, [resumes]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">TalentFlow</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="size-4" />
            Salir
          </Button>
        </header>

        {profile === undefined || resumes === undefined ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : profile === null ? (
          /* ── Empty state: sin CV ─────────────────────────────────── */
          <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-border">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">
              Hola{user?.name ? `, ${user.name}` : ""} — sube tu CV para empezar
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Analizaremos tu experiencia con IA y te daremos un diagnóstico de
              empleabilidad con oportunidades concretas de mejora. Todo queda
              privado y editable.
            </p>
            <div className="mt-8 w-full max-w-md">
              <CvUpload versions={[]} onVersionsChanged={() => {}} />
            </div>
          </div>
        ) : (
          <>
            <div className="hairline-b mt-10 pb-8">
              <BasicsEditor profile={profile} />
            </div>

            {/* Tabs simples accesibles */}
            <div
              role="tablist"
              aria-label="Secciones"
              className="mt-8 flex gap-1"
            >
              {(
                [
                  ["diagnostico", "Diagnóstico"],
                  ["cv", "Mi CV"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    tab === key
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              {tab === "diagnostico" && (
                <div>
                  <Diagnóstico profile={profile} />
                  {diagnosis && !diagnosis.hasSufficientData && (
                    <p className="mt-6 text-xs text-muted-foreground">
                      Nota: el diagnóstico mejora con más datos del CV (experiencia
                      con logros, skills y resumen).
                    </p>
                  )}
                </div>
              )}
              {tab === "cv" && <MiCv profile={profile} resumes={resumes} />}
            </div>

            <div className="mt-4">
              <CvUpload
                versions={activeVersions}
                onVersionsChanged={() => {
                  /* Convex reactivity refetches automatically */
                }}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
