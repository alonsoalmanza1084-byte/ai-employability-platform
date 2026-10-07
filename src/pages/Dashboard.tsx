import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { Briefcase, Check, FileText, GraduationCap, LayoutDashboard, LogOut, MessageSquare, Pencil, Plus, RefreshCw, Send, Sparkles, Trophy, Trash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { CvUpload } from "@/components/CvUpload";

type Profile = Doc<"candidateProfiles">;
type ResumeGroup = { resume: Doc<"resumes">; versions: Doc<"resumeVersions">[] };
/** Forma devuelta por `career.myCareerGoals` (doc propio sin campos internos). */
type CareerGoalView = {
  _id: Id<"careerGoals">;
  kind: "target_role" | "aspiration" | "goal";
  value: string;
  skills: GoalSkillInput[];
  source: "user-provided" | "system-derived" | "ai-generated" | "proposed" | "verified";
  createdAt: number;
  updatedAt: number;
};

function targetGoalFromGoals(goals: CareerGoalView[] | null | undefined) {
  if (!goals) return null;
  return goals.find((g) => g.kind === "target_role") ?? null;
}

const ROLE_TEMPLATES: { id: string; label: string; description: string; skills: { name: string; requiredLevel: number; category?: string }[] }[] = [
  { id: "senior-frontend", label: "Senior Frontend Developer", description: "Frontend senior con arquitectura y leadership técnico.", skills: [{ name: "React", requiredLevel: 4 }, { name: "TypeScript", requiredLevel: 4 }, { name: "Testing", requiredLevel: 3 }, { name: "Architecture", requiredLevel: 3 }, { name: "Communication", requiredLevel: 3 }] },
  { id: "frontend-tech-lead", label: "Frontend Tech Lead", description: "Lidera equipos frontend y define arquitectura.", skills: [{ name: "React", requiredLevel: 4 }, { name: "TypeScript", requiredLevel: 4 }, { name: "Leadership", requiredLevel: 4 }, { name: "Architecture", requiredLevel: 4 }, { name: "Communication", requiredLevel: 4 }] },
  { id: "product-engineer", label: "Product Engineer", description: "Ingeniero orientado a producto y resultados de negocio.", skills: [{ name: "React", requiredLevel: 3 }, { name: "TypeScript", requiredLevel: 3 }, { name: "Product Sense", requiredLevel: 4 }, { name: "Communication", requiredLevel: 3 }, { name: "Data Analysis", requiredLevel: 2 }] },
];

function roleSkillsAsRequired(template: (typeof ROLE_TEMPLATES)[number]): GoalSkillInput[] {
  return template.skills.map((s) => ({ name: s.name, requiredLevel: s.requiredLevel, category: s.category }));
}

function findRoleTemplateByLabel(label: string): (typeof ROLE_TEMPLATES)[number] | null {
  const normalized = label.trim().toLowerCase();
  return ROLE_TEMPLATES.find((t) => t.label.toLowerCase() === normalized || t.label.toLowerCase().includes(normalized) || normalized.includes(t.label.toLowerCase())) ?? null;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  return (<div className="flex flex-col items-center gap-2"><div className="relative flex size-20 items-center justify-center rounded-full border border-border" role="img" aria-label={`${label}: ${score} de 100`}><span className="text-2xl font-semibold tabular-nums">{score}</span><span className="absolute bottom-3 text-[10px] uppercase tracking-widest text-muted-foreground">/100</span></div><span className="text-xs font-medium text-muted-foreground">{label}</span></div>);
}

function Dimension({ label, score, children }: { label: string; score: number; children?: React.ReactNode }) {
  return (<div><div className="flex items-baseline justify-between"><p className="text-sm font-medium">{label}</p><p className="text-sm tabular-nums text-muted-foreground">{score}/100</p></div><Progress value={score} className="mt-2 h-1" />{children}</div>);
}

function Diagnóstico({ profile }: { profile: Profile }) {
  const d = profile.diagnosis;
  const scores = [{ label: "Completitud", value: d?.completeness ?? 0 }, { label: "Impacto", value: d?.impact ?? 0 }, { label: "Skills", value: d?.skills ?? 0 }, { label: "Narrativa", value: d?.narrative ?? 0 }];
  return (<section aria-labelledby="diagnosis-title" className="mt-12"><div className="hairline-b pb-4"><p className="eyebrow">Diagnóstico de empleabilidad</p><h2 id="diagnosis-title" className="mt-1 text-xl font-semibold">Dónde estás hoy</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Evaluación determinista sobre tu perfil actual. No es una promesa de resultados: son señales de mejora con acciones concretas.{" "}{!d?.hasSufficientData && " Aún hay pocos datos para algunas métricas."}</p></div><div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">{scores.map((s) => (<ScoreRing key={s.label} score={s.value} label={s.label} />))}</div><div className="mt-8 grid gap-8 lg:grid-cols-2"><div className="space-y-6">{scores.map((s) => (<Dimension key={s.label} label={s.label} score={s.value}><p className="mt-1 text-xs text-muted-foreground">{s.value >= 75 ? "Fortaleza actual." : s.value >= 45 ? "Rango intermedio: hay margen de mejora." : "Prioridad de mejora."}</p></Dimension>))}</div><div><h3 className="text-sm font-semibold">Oportunidades de mejora</h3>{d?.opportunities?.length ? (<ul className="mt-3 space-y-3">{d.opportunities.map((o, i) => (<li key={i} className="flex gap-3 text-sm"><Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p className="font-medium capitalize">{o.dimension}</p><p className="mt-0.5 text-muted-foreground">{o.reason}</p></div></li>))}</ul>) : (<p className="mt-3 text-sm text-muted-foreground">Sin oportunidades detectadas por ahora: tu perfil cubre lo básico.</p>)}</div></div></section>);
}

function SkillsEditor({ profile }: { profile: Profile }) {
  const updateProfile = useMutation(api.candidates.updateProfile);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(3);
  const [busy, setBusy] = useState(false);
  async function addSkill() { if (!name.trim()) return; setBusy(true); try { await updateProfile({ skills: [...profile.skills, { name: name.trim(), level, source: "human" as const }] }); setName(""); } finally { setBusy(false); } }
  async function removeSkill(skillName: string) { setBusy(true); try { await updateProfile({ skills: profile.skills.filter((s) => s.name !== skillName) }); } finally { setBusy(false); } }
  return (<div><div className="flex flex-wrap gap-2">{profile.skills.map((s) => (<Badge key={s.name} variant="secondary" className="gap-1.5 pr-1">{s.name} · L{s.level}{s.source === "human" && (<span className="text-[10px] text-muted-foreground">(tú)</span>)}<button aria-label={`Quitar ${s.name}`} className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10" onClick={() => void removeSkill(s.name)} disabled={busy}><X className="size-3" /></button></Badge>))} {profile.skills.length === 0 && (<p className="text-sm text-muted-foreground">Sin skills aún. Añade al menos las 5 principales.</p>)}</div><div className="mt-3 flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Añadir skill (ej. SQL)" className="h-9 max-w-48" onKeyDown={(e) => e.key === "Enter" && void addSkill()} /><select aria-label="Nivel" value={level} onChange={(e) => setLevel(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">{[1, 2, 3, 4, 5].map((l) => (<option key={l} value={l}>Nivel {l}</option>))}</select><Button variant="outline" size="sm" onClick={() => void addSkill()} disabled={busy || !name.trim()}><Plus className="size-4" />Añadir</Button></div></div>);
}

function BasicsEditor({ profile }: { profile: Profile }) {
  const updateProfile = useMutation(api.candidates.updateProfile);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: profile.fullName ?? "", headline: profile.headline ?? "", location: profile.location ?? "", summary: profile.summary ?? "", yearsExperience: String(profile.yearsExperience ?? "") });
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { await updateProfile({ fullName: form.fullName || undefined, headline: form.headline || undefined, location: form.location || undefined, summary: form.summary || undefined, yearsExperience: form.yearsExperience ? Number(form.yearsExperience) : undefined }); setEditing(false); } finally { setBusy(false); } }
  if (!editing) return (<div className="flex items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{profile.fullName || "Tu perfil"}</h1><p className="mt-1 text-sm text-muted-foreground">{profile.headline || "Sin titular profesional"}{profile.location ? ` · ${profile.location}` : ""}{profile.yearsExperience !== undefined ? ` · ${profile.yearsExperience} años de experiencia` : ""}</p>{profile.summary && (<p className="mt-3 max-w-2xl text-sm leading-6">{profile.summary}</p>)}</div><Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" />Editar</Button></div>);
  return (<div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="fullName">Nombre completo</Label><Input id="fullName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="headline">Titular profesional</Label><Input id="headline" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="Ej. Analista de datos con 4 años en BI" /></div><div className="space-y-1.5"><Label htmlFor="location">Ubicación</Label><Input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="years">Años de experiencia</Label><Input id="years" type="number" min={0} max={60} value={form.yearsExperience} onChange={(e) => setForm({ ...form, yearsExperience: e.target.value })} /></div></div><div className="space-y-1.5"><Label htmlFor="summary">Resumen profesional</Label><Textarea id="summary" rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div><div className="flex gap-2"><Button size="sm" onClick={() => void save()} disabled={busy}><Check className="size-4" />Guardar</Button><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button></div></div>);
}

function MiCv({ profile }: { profile: Profile }) {
  return (<section aria-labelledby="cv-title" className="mt-12"><div className="hairline-b pb-4"><p className="eyebrow">Mi CV</p><h2 id="cv-title" className="mt-1 text-xl font-semibold">Versión estructurada</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Extraído por IA de tu CV activo y editable por ti. Los datos que corriges prevalecen sobre los detectados automáticamente.</p></div><div className="mt-8 grid gap-10 lg:grid-cols-2"><div className="space-y-8"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Briefcase className="size-4 text-muted-foreground" />Experiencia</h3><ul className="mt-4 space-y-5">{profile.experience.map((e, i) => (<li key={i} className="border-l border-border pl-4"><p className="text-sm font-medium">{e.title}</p><p className="text-sm text-muted-foreground">{e.company} · {e.start}{e.end ? ` – ${e.end}` : e.current ? " – actual" : ""}</p>{e.description && (<p className="mt-1.5 text-sm leading-6 text-muted-foreground">{e.description}</p>)}{e.achievements.length > 0 && (<ul className="mt-2 space-y-1">{e.achievements.map((a, j) => (<li key={j} className="flex gap-2 text-sm"><span className="text-muted-foreground">—</span>{a}</li>))}</ul>)}</li>))}{profile.experience.length === 0 && (<li className="text-sm text-muted-foreground">Sin experiencia registrada.</li>)}</ul></div><div><h3 className="flex items-center gap-2 text-sm font-semibold"><GraduationCap className="size-4 text-muted-foreground" />Educación</h3><ul className="mt-4 space-y-3">{profile.education.map((e, i) => (<li key={i} className="text-sm"><p className="font-medium">{e.degree}{e.field ? ` — ${e.field}` : ""}</p><p className="text-muted-foreground">{e.institution}{e.endYear ? ` · ${e.endYear}` : ""}</p></li>))}{profile.education.length === 0 && (<li className="text-sm text-muted-foreground">Sin educación registrada.</li>)}</ul></div></div><div className="space-y-8"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Trophy className="size-4 text-muted-foreground" />Certificaciones</h3><ul className="mt-4 space-y-2">{profile.certifications.map((c, i) => (<li key={i} className="text-sm">{c.name}{c.issuer ? ` · ${c.issuer}` : ""}{c.year ? ` (${c.year})` : ""}</li>))}{profile.certifications.length === 0 && (<li className="text-sm text-muted-foreground">Sin certificaciones registradas.</li>)}</ul></div><div><h3 className="text-sm font-semibold">Skills</h3><div className="mt-4"><SkillsEditor profile={profile} /></div></div></div></div></section>);
}

function Coach() {
  const state = useQuery(api.coach.getConversation);
  const startConversation = useMutation(api.coach.startConversation);
  const sendMessageWithProposals = useAction(api.coach.sendMessageWithProposals);
  const rejectProposalByOwner = useMutation(api.coach.rejectProposalByOwner);
  const proposals = useQuery(api.coach.listProposals, state?.conversation ? { conversationId: state.conversation._id } : "skip");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Id<"coachProposals"> | null>(null);
  const [rejecting, setRejecting] = useState<Id<"coachProposals"> | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageCount = state?.messages.length ?? 0;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messageCount]);

  async function handleStart() { setBusy(true); setError(null); try { const res = await startConversation({}); if (!res.ok) setError(res.reason); } catch { setError("No se pudo iniciar la conversación. Reintenta."); } finally { setBusy(false); } }
  async function handleSend() { const text = draft.trim(); if (!text || busy || !state?.conversation) return; setBusy(true); setError(null); try { const res = await sendMessageWithProposals({ conversationId: state.conversation._id, message: text }); if (res.ok) setDraft(""); else setError(res.reason); } catch { setError("No se pudo enviar el mensaje. Reintenta."); } finally { setBusy(false); } }
  async function confirmReject() {
    if (!rejectTarget || rejecting !== null) return;
    setRejecting(rejectTarget);
    setProposalError(null);
    try {
      const res = await rejectProposalByOwner({ proposalId: rejectTarget });
      if (res.ok) {
        // Sin optimistic update: al cerrar, listProposals (reactiva) refresca.
        setRejectTarget(null);
      } else {
        // Error real del backend: se anuncia, sin falso éxito (INV-UI-008).
        setProposalError(res.reason);
      }
    } catch {
      setProposalError("No se pudo rechazar la propuesta. Reintenta.");
    } finally {
      setRejecting(null);
    }
  }

  return (
    <section aria-labelledby="coach-title" className="mt-12">
      <div className="hairline-b flex flex-wrap items-end justify-between gap-4 pb-4">
        <div>
          <p className="eyebrow">Career Coach IA</p>
          <h2 id="coach-title" className="mt-1 text-xl font-semibold">Conversa sobre tu perfil</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Tu coach lee tu perfil y tu diagnóstico para explicártelos, preguntarte lo que haga falta y descubrir huecos. No modifica tu perfil ni tu CV. Si te propone una mejora, la verás como propuesta pendiente de confirmación: nunca se aplica sola.</p>
        </div>
        {state && (<Button variant="outline" size="sm" onClick={() => void handleStart()} disabled={busy}><Plus className="size-4" />Nueva conversación</Button>)}
      </div>
      {state === undefined ? (<div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">Cargando…</div>) : state === null ? (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-lg border border-border p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-border"><MessageSquare className="size-5 text-muted-foreground" /></div>
          <p className="max-w-md text-sm text-muted-foreground">Aún no has empezado. El coach parte de tu perfil actual: pregúntale por tu diagnóstico, qué mejorar o qué contar en tu próximo CV.</p>
          <Button onClick={() => void handleStart()} disabled={busy}><Sparkles className="size-4" />Empezar conversación</Button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex max-h-[28rem] flex-col gap-4 overflow-y-auto rounded-lg border border-border p-4">
            {state.messages.length === 0 && (<p className="text-sm text-muted-foreground">Escribe tu primer mensaje para arrancar la conversación.</p>)}
            {state.messages.map((m) => m.role === "user" ? (<div key={m._id} className="max-w-[85%] self-end rounded-xl bg-secondary px-3.5 py-2 text-sm text-secondary-foreground">{m.content}</div>) : (
              <div key={m._id} className="max-w-[92%] self-start rounded-xl border border-border bg-card px-3.5 py-2.5">
                <p className="whitespace-pre-wrap text-sm leading-6">{m.content}</p>
                {m.observations && m.observations.length > 0 && (<ul className="mt-2 space-y-1 border-t border-border pt-2">{m.observations.map((o, i) => (<li key={i} className="flex gap-2 text-xs text-muted-foreground"><Sparkles className="mt-0.5 size-3 shrink-0" /><span>{o}</span></li>))}</ul>)}
                {m.questions && m.questions.length > 0 && (<div className="mt-2 border-t border-border pt-2"><p className="text-xs font-medium">Para saber más</p><ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">{m.questions.map((q, i) => (<li key={i}>{q}</li>))}</ol></div>)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          {proposals && proposals.proposals.length > 0 && (
            <section aria-label="Propuestas de mejora" className="mt-6 rounded-lg border border-border p-4">
              <p className="eyebrow">Propuestas de mejora</p>
              <p className="mt-1 text-xs text-muted-foreground">El coach propone mejoras basadas en evidencia de tu perfil validada en el servidor. Son propuestas: nunca se aplican a tu perfil ni a tu CV — tú decides.</p>
              <ul className="mt-3 space-y-3">{proposals.proposals.map((p) => (
                <li key={p._id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">Propuesta de mejora</p>{p.status === "pending" ? (<Badge variant="secondary">Pendiente de confirmación</Badge>) : (<Badge variant="outline" className="text-muted-foreground">Rechazada</Badge>)}</div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6">{p.proposedText}</p>
                    </div>
                    {p.status === "pending" && (<Button variant="outline" size="sm" onClick={() => { setProposalError(null); setRejectTarget(p._id); }} disabled={rejecting !== null}>Rechazar</Button>)}
                  </div>
                </li>
              ))}</ul>
              {proposalError && (<p role="alert" className="mt-3 text-sm text-destructive">{proposalError}</p>)}
            </section>
          )}
          <AlertDialog open={rejectTarget !== null} onOpenChange={(open) => { if (!open && rejecting === null) setRejectTarget(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>¿Rechazar esta propuesta?</AlertDialogTitle><AlertDialogDescription>Se marcará como «Rechazada». No se modifica tu perfil ni tu CV: solo deja de estar pendiente de confirmación.</AlertDialogDescription></AlertDialogHeader>
              {proposalError && (<p role="alert" className="text-sm text-destructive">{proposalError}</p>)}
              <AlertDialogFooter><AlertDialogCancel disabled={rejecting !== null}>Cancelar</AlertDialogCancel><Button variant="destructive" onClick={() => void confirmReject()} disabled={rejecting !== null}>{rejecting !== null ? "Rechazando…" : "Rechazar propuesta"}</Button></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {error && (<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>)}
          <div className="mt-4 flex items-end gap-2">
            <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1500} placeholder="P. ej.: ¿Por qué mi impacto está en 40 y cómo lo mejoro?" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }} />
            <Button onClick={() => void handleSend()} disabled={busy || !draft.trim()}><Send className="size-4" />{busy ? "Enviando…" : "Enviar"}</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Límite diario de mensajes. El coach solo lee tu perfil; no lo modifica, y cualquier propuesta que haga requiere tu confirmación.</p>
        </>
      )}
    </section>
  );
}

function nextActionFromGap(gap: GapResult | undefined, profile: Profile | null | undefined, targetValue: string | null): string {
  if (!gap || !profile || !targetValue) return profile ? "Define un objetivo profesional para ver tu siguiente acción." : "Sube tu CV para comenzar.";
  const skills = gap.analysis.skills;
  const gaps = skills.filter((s) => s.status === "gap");
  const weak = skills.filter((s) => s.status === "missing_evidence" || s.status === "insufficient_evidence");
  if (gaps.length === 0 && weak.length === 0) return `Tu perfil cubre los requisitos registrados para ${targetValue}. Estás en condiciones de perseguirlo con la evidencia actual.`;
  if (gaps.length > 0) { const top = gaps.slice().sort((a, b) => b.requiredLevel - a.requiredLevel)[0]; return `Fortalece ${top.skill}: tienes nivel ${top.currentLevel ?? 0} pero ${targetValue} pide ${top.requiredLevel}. ${top.explanation}`; }
  const top = weak[0];
  if (top.status === "missing_evidence") return `Registra ${top.skill}: no tenemos evidencia de esta habilidad en tu perfil (no decimos que no sepas hacerlo — aún no lo tenemos registrado). ${top.explanation}`;
  return `Revisa ${top.skill}: la detección es de baja confianza. Corrígela para que cuente como evidencia. ${top.explanation}`;
}

function Carrera({ profile, targetGoal, gap, roles, setGoal, removeGoal, regenerate }: {
  profile: Profile;
  targetGoal: CareerGoalView | null;
  gap: GapResult | undefined;
  roles: RoleMatch[] | undefined;
  setGoal: (args: { kind: "target_role" | "aspiration" | "goal"; value: string; skills?: GoalSkillInput[]; source?: "user-provided" | "system-derived" | "ai-generated" | "proposed" | "verified"; }) => Promise<{ _id: Id<"careerGoals"> | void; action: "created" | "updated" }>;
  removeGoal: (args: { goalId: Id<"careerGoals"> }) => Promise<{ ok: boolean }>;
  regenerate: (args: { targetId: Id<"careerGoals"> }) => Promise<{ ok: boolean; _id: Id<"gapAnalyses">; regenerated: boolean }>;
}) {
  const targetValue = targetGoal?.value ?? null;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateSkills, setTemplateSkills] = useState<GoalSkillInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const suggested = editValue.trim() ? findRoleTemplateByLabel(editValue.trim()) : null;

  function openEdit() { if (!targetGoal) return; setEditValue(targetGoal.value); const m = findRoleTemplateByLabel(targetGoal.value); setUseTemplate(!!m); setTemplateSkills(m ? roleSkillsAsRequired(m) : (targetGoal.skills as unknown as GoalSkillInput[])); setEditing(true); }
  async function save() { if (!editValue.trim() || busy) return; setBusy(true); try { await setGoal({ kind: "target_role", value: editValue.trim(), ...(useTemplate && templateSkills.length > 0 ? { skills: templateSkills } : {}), source: "user-provided" }); setEditing(false); } finally { setBusy(false); } }
  async function remove() { if (!targetGoal || removing) return; setRemoving(true); try { await removeGoal({ goalId: targetGoal._id }); } finally { setRemoving(false); } }
  async function refreshGap() { if (!targetGoal) return; void regenerate({ targetId: targetGoal._id }); }

  const skillsList = targetGoal?.skills ?? [];

  const coverage = gap?.analysis.overallCoverage;
  const gapSkills = gap?.analysis.skills ?? [];
  const metSkills = gapSkills.filter((s) => s.status === "meets_requirement");
  const gapOnly = gapSkills.filter((s) => s.status === "gap");
  const weakSkills = gapSkills.filter((s) => s.status === "missing_evidence" || s.status === "insufficient_evidence");

  return (
    <section aria-labelledby="carrera-title" className="mt-12">
      <div className="hairline-b pb-4">
        <p className="eyebrow">Tu carrera</p>
        <h2 id="carrera-title" className="mt-1 text-xl font-semibold">De tu CV a tu siguiente paso</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Elige un puesto que te interese y te mostramos qué tienes, qué te falta y qué puestos son compatibles con tu evidencia actual.</p>
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <div className="space-y-8">
          {targetGoal ? (
            <section aria-labelledby="objetivo-title">
              <h3 id="objetivo-title" className="text-sm font-semibold">Tu objetivo profesional</h3>
              <div className="mt-3 rounded-lg border border-border bg-card p-4">
                <p className="text-lg font-medium">{targetValue}</p>
                {skillsList.length > 0 && (<div className="mt-3 flex flex-wrap gap-2">{skillsList.map((s) => (<Badge key={s.name} variant="secondary" className="gap-1.5">{s.name} · nivel {(s as GoalSkillInput).requiredLevel}</Badge>))}</div>)}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit()}><Pencil className="size-4" />Editar</Button>
                  <Button variant="outline" size="sm" onClick={() => void refreshGap()} disabled={busy}><RefreshCw className="size-4" />Recalcular</Button>
                  <Button variant="outline" size="sm" onClick={() => void remove()} disabled={removing || busy}><Trash className="size-4" />Eliminar objetivo</Button>
                </div>
              </div>
            </section>
          ) : (
            <section aria-labelledby="objetivo-title">
              <h3 id="objetivo-title" className="text-sm font-semibold">Define tu objetivo profesional</h3>
              {editing ? (
                <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-3">
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="P. ej. Senior Frontend Developer" maxLength={120} autoFocus />
                  {suggested && (<p className="text-sm text-muted-foreground">Coincide con: <span className="font-medium">{suggested.label}</span> — {suggested.description}</p>)}
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useTemplate} disabled={!suggested ? false : undefined} onChange={(e) => setUseTemplate(e.target.checked)} className="mt-1 h-4 w-4 rounded border-input" /><span>Usar requisitos de referencia({suggested ? suggested.label : "personalizados"}){useTemplate && templateSkills.length > 0 && (<span className="text-muted-foreground"> · {templateSkills.length} skills</span>)}</span></label>
                  <div className="flex gap-2"><Button size="sm" onClick={() => void save()} disabled={busy || !editValue.trim() || (Boolean(suggested) && !useTemplate)}><Check className="size-4" />Guardar objetivo</Button><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button></div>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="¿Qué puesto quieres conseguir?" maxLength={120} />
                  {suggested && (<p className="text-sm text-muted-foreground">Encontramos referencia: <span className="font-medium">{suggested.label}</span> — {suggested.description}</p>)}
                  <div className="flex flex-wrap gap-2 text-sm">{ROLE_TEMPLATES.slice(0, 6).map((r) => (<button key={r.id} type="button" onClick={() => setEditValue(r.label)} className="rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">{r.label}</button>))}</div>
                  <Button size="sm" onClick={() => { setUseTemplate(!!suggested); setTemplateSkills(suggested ? (roleSkillsAsRequired(suggested) as GoalSkillInput[]) : []); setEditing(true); }} disabled={busy || !editValue.trim()}><Plus className="size-4" />Avanzar con esto</Button>
                </div>
              )}
            </section>
          )}
          {gap && profile ? (
            <section aria-labelledby="brecha-title">
              <h3 id="brecha-title" className="text-sm font-semibold">Tu brecha para {targetValue ?? "..."}</h3>
              <div className="mt-3 flex items-baseline gap-3"><span className="text-3xl font-semibold tabular-nums">{coverage}</span><span className="text-sm text-muted-foreground">% de requisitos cubiertos</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{gapSkills.length} requisito(s) evaluado(s) con tu evidencia actual.</p>
              <div className="mt-4 space-y-5">
                {metSkills.length > 0 && (<div><p className="text-sm font-medium text-green-600">Lo que ya tienes</p><ul className="mt-2 space-y-2">{metSkills.map((s) => (<li key={s.skill} className="flex gap-3 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-green-600" /><div><p className="font-medium">{s.skill}</p><p className="text-muted-foreground">Nivel {s.currentLevel} ≥ {s.requiredLevel} requerido.</p></div></li>))}</ul></div>)}
                {gapOnly.length > 0 && (<div><p className="text-sm font-medium">Para llegar ahí</p><ul className="mt-2 space-y-2">{gapOnly.map((s) => (<li key={s.skill} className="flex gap-3 text-sm"><span className="mt-0.5 shrink-0 text-sm font-medium">△</span><div><p className="font-medium">{s.skill}</p><p className="text-muted-foreground">Nivel {s.currentLevel} &lt; {s.requiredLevel} requerido. {s.explanation}</p></div></li>))}</ul></div>)}
                {weakSkills.length > 0 && (<div><p className="text-sm font-medium text-amber-600">Falta evidencia</p><p className="mt-1 text-xs text-muted-foreground">No decimos que no sepas hacerlo: aún no tenemos registro o la detección es de baja confianza. Agrega la experiencia o corrige el nivel.</p><ul className="mt-2 space-y-2">{weakSkills.map((s) => (<li key={s.skill} className="flex gap-3 text-sm"><span className="mt-0.5 shrink-0 text-sm">○</span><div><p className="font-medium">{s.skill}</p><p className="text-muted-foreground">{s.explanation}</p></div></li>))}</ul></div>)}
                {metSkills.length === 0 && gapOnly.length === 0 && weakSkills.length === 0 && (<p className="text-sm text-muted-foreground">Sin requisitos registrados para este objetivo.</p>)}
              </div>
            </section>
          ) : (
            <section aria-labelledby="brecha-title"><h3 id="brecha-title" className="text-sm font-semibold">Tu brecha</h3><p className="mt-2 text-sm text-muted-foreground">{profile ? "Define un objetivo profesional para ver qué te hace falta." : "Sube tu CV para comenzar."}</p></section>
          )}
          <section aria-labelledby="next-title">
            <h3 id="next-title" className="text-sm font-semibold">Tu siguiente acción</h3>
            <div className="mt-3 rounded-lg border border-border bg-card p-4">
              <p className="text-sm leading-6">{nextActionFromGap(gap, profile, targetValue)}</p>
              {(gapSkills.some((s) => s.status === "gap" || s.status === "missing_evidence" || s.status === "insufficient_evidence") || metSkills.length === 0) && (
                <div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => void refreshGap()} disabled={busy}><RefreshCw className="size-4" />Recalcular</Button><Button asChild><a href="/dashboard?tab=coach" className="flex items-center gap-2"><Sparkles className="size-4" />Preguntar al coach</a></Button></div>
              )}
            </div>
          </section>
        </div>
        <div className="space-y-8">
          <section aria-labelledby="roles-title">
            <h3 id="roles-title" className="text-sm font-semibold">Roles compatibles</h3>
            {roles && roles.length > 0 ? (
              <ul className="mt-4 space-y-3">{roles.map((r) => (
                <li key={r.roleId} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{r.label}</p><p className="mt-0.5 text-sm text-muted-foreground">{r.description}</p></div><div className="shrink-0 text-right"><span className={`text-lg font-semibold tabular-nums ${r.match.overall >= 70 ? "text-green-600" : r.match.overall >= 45 ? "text-amber-600" : "text-muted-foreground"}`}>{r.match.overall}%</span><p className="text-xs text-muted-foreground">match</p></div></div>
                  <ul className="mt-3 space-y-1.5">{r.match.requirements.slice(0, 5).map((req) => (
                    <li key={req.requirementId} className="flex gap-2 text-sm">{req.met ? (<Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />) : (<span className="mt-0.5 shrink-0 text-sm">△</span>)}<span className="truncate"><span className="font-medium">{req.label}</span> {" "}<span className="text-muted-foreground">{req.score}/100</span></span></li>
                  ))}</ul>
                </li>
              ))}</ul>
            ) : (<div className="mt-4 rounded-lg border border-border bg-card p-6 text-center"><p className="text-sm text-muted-foreground">{profile ? "Sube tu CV para ver roles compatibles." : "Sube tu CV para comenzar."}</p></div>)}
          </section>
          <p className="text-xs text-muted-foreground">Los match son deterministas y explican qué cumple y qué falta. No es una promesa de resultado ni una decisión de contratación.</p>
        </div>
      </div>
      {editing && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">{targetGoal ? "Editar objetivo" : "Nuevo objetivo"}</h3>
          <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="P. ej. Senior Frontend Developer" maxLength={120} autoFocus />
          {suggested && !targetGoal && (<p className="text-sm text-muted-foreground">Coincide con: <span className="font-medium">{suggested.label}</span> — {suggested.description}</p>)}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useTemplate} disabled={!suggested && !targetGoal ? false : undefined} onChange={(e) => setUseTemplate(e.target.checked)} className="mt-1 h-4 w-4 rounded border-input" /><span>Usar requisitos de referencia({suggested ? suggested.label : targetGoal ? "actuales" : "personalizados"}){useTemplate && templateSkills.length > 0 && (<span className="text-muted-foreground"> · {templateSkills.length} skills</span>)}</span></label>
          <div className="flex gap-2"><Button size="sm" onClick={() => void save()} disabled={busy || !editValue.trim() || (Boolean(suggested) && !useTemplate)}><Check className="size-4" />Guardar</Button><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button></div>
        </div>
      )}
    </section>
  );
}

type GapSkill = { skill: string; requiredLevel: number; currentLevel?: number; status: | "meets_requirement" | "gap" | "missing_evidence" | "insufficient_evidence"; evidenceRefs: string[]; explanation: string };
type GapResult = { _id: Id<"gapAnalyses"> | null; analysis: { targetId: string; engineVersion: string; generatedAt: number; overallCoverage: number; skills: GapSkill[] }; computedAt: number };
type GoalSkillInput = { name: string; requiredLevel: number; category?: string };
type RoleMatch = { roleId: string; label: string; description: string; matchVersion: string; match: { overall: number; skills: number; experience: number; education: number; requirements: Array<{ requirementId: string; label: string; met: boolean; score: number; evidence: string; gap?: string }>; engineVersion: string } };

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery(api.candidates.myProfile);
  const resumes = useQuery(api.candidates.myResumes);
  const diagnosis = useQuery(api.candidates.diagnosis);
  const [tab, setTab] = useState<"cv" | "diagnostico" | "coach" | "carrera">("diagnostico");
  const goals = useQuery(api.career.myCareerGoals);
  const targetGoal = targetGoalFromGoals(goals);
  const gap = useQuery(api.career.myGapAnalysis, targetGoal ? { targetId: targetGoal._id } : "skip");
  const roles = useQuery(api.career.compatibleRoles, { limit: 6 });
  const setGoal = useMutation(api.career.setCareerGoal);
  const removeGoal = useMutation(api.career.removeCareerGoal);
  const regenerate = useMutation(api.career.regenerateGapAnalysis);

  const activeVersions: Doc<"resumeVersions">[] = useMemo(() => { if (!resumes) return []; return (resumes as ResumeGroup[]).flatMap((r) => r.versions); }, [resumes]);

  const handleSignOut = async () => { await signOut(); navigate("/"); };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2"><LayoutDashboard className="size-4 text-muted-foreground" /><span className="text-sm font-medium">TalentFlow</span></div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}><LogOut className="size-4" />Salir</Button>
        </header>
        {profile === undefined || resumes === undefined ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Cargando…</div>
        ) : profile === null ? (
          <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-border"><FileText className="size-6 text-muted-foreground" /></div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">Hola{user?.name ? `, ${user.name}` : ""} — sube tu CV para empezar</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">Analizaremos tu experiencia con IA y te daremos un diagnóstico de empleabilidad con oportunidades concretas de mejora. Todo queda privado y editable.</p>
            <div className="mt-8 w-full max-w-md"><CvUpload versions={[]} onVersionsChanged={() => {}} /></div>
          </div>
        ) : (
          <>
            <div className="hairline-b mt-10 pb-8"><BasicsEditor profile={profile} /></div>
            <div role="tablist" aria-label="Secciones" className="mt-8 flex gap-1">
              {([["diagnostico", "Diagnóstico"], ["cv", "Mi CV"], ["coach", "Coach"], ["carrera", "Carrera"]] as const).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === key ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
            <div className="relative">
              {tab === "diagnostico" && (<div><Diagnóstico profile={profile} />{diagnosis && !diagnosis.hasSufficientData && (<p className="mt-6 text-xs text-muted-foreground">Nota: el diagnóstico mejora con más datos del CV (experiencia con logros, skills y resumen).</p>)}</div>)}
              {tab === "cv" && <MiCv profile={profile} />}
              {tab === "coach" && <Coach />}
              {tab === "carrera" && <Carrera profile={profile} targetGoal={targetGoal} gap={gap} roles={roles} setGoal={setGoal} removeGoal={removeGoal} regenerate={regenerate} />}
            </div>
            <div className="mt-4"><CvUpload versions={activeVersions} onVersionsChanged={() => {}} /></div>
          </>
        )}
      </div>
    </main>
  );
}
