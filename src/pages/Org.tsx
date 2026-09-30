import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Building2,
  Check,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  ACCEPTED_CV_TYPES,
  MAX_CV_MB,
  uploadToConvexStorage,
  validateCvFile,
} from "@/lib/upload";

const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  shortlisted: "Preseleccionado",
  rejected: "Rechazado",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={status === "shortlisted" ? "default" : "secondary"}
      className={
        status === "rejected" ? "bg-destructive/10 text-destructive" : undefined
      }
    >
      {statusLabel[status] ?? status}
    </Badge>
  );
}

function MatchBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <Progress value={value} className="mt-1 h-1" />
    </div>
  );
}

/** ── Crear vacante ─────────────────────────────────────────────────────── */
function NewJobDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: Id<"organizations">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const createJob = useMutation(api.jobs.create);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [seniority, setSeniority] = useState("");
  const [reqs, setReqs] = useState<
    {
      type: "skill" | "experience_years" | "education" | "certification";
      label: string;
      minLevel?: number;
      minYears?: number;
      weight: number;
      isMustHave: boolean;
    }[]
  >([{ type: "skill", label: "", minLevel: 3, weight: 1, isMustHave: true }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createJob({
        organizationId,
        title,
        description,
        location: location || undefined,
        seniority: seniority || undefined,
        requirements: reqs.map((r) => ({
          type: r.type,
          label: r.label,
          minLevel: r.type === "skill" ? r.minLevel : undefined,
          minYears: r.type === "experience_years" ? r.minYears : undefined,
          weight: r.weight,
          isMustHave: r.isMustHave,
        })),
      });
      onCreated();
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setReqs([
        { type: "skill", label: "", minLevel: 3, weight: 1, isMustHave: true },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear.");
    } finally {
      setBusy(false);
    }
  }

  function updateReq(i: number, patch: Partial<(typeof reqs)[number]>) {
    setReqs(reqs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva vacante</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="job-title">Título</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Data Engineer Sr."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-loc">Ubicación</Label>
              <Input
                id="job-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Remoto · CDMX"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-sen">Seniority</Label>
              <Input
                id="job-sen"
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                placeholder="Senior"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-desc">Descripción</Label>
            <Textarea
              id="job-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qué hará la persona, equipo, contexto…"
            />
          </div>

          <div>
            <Label>Requisitos</Label>
            <div className="mt-2 space-y-3">
              {reqs.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-2 items-end gap-2 rounded-md border border-border p-3 sm:grid-cols-5"
                >
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <select
                      aria-label="Tipo de requisito"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={r.type}
                      onChange={(e) =>
                        updateReq(i, {
                          type: e.target.value as (typeof reqs)[number]["type"],
                        })
                      }
                    >
                      <option value="skill">Skill</option>
                      <option value="experience_years">Años exp.</option>
                      <option value="education">Educación</option>
                      <option value="certification">Certificación</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre</Label>
                    <Input
                      value={r.label}
                      onChange={(e) => updateReq(i, { label: e.target.value })}
                      placeholder={
                        r.type === "skill"
                          ? "React"
                          : r.type === "experience_years"
                            ? "3 años en backend"
                            : r.type === "education"
                              ? "Ing. Computación"
                              : "AWS CP"
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {r.type === "skill" ? "Nivel mín." : "Peso"}
                    </Label>
                    {r.type === "skill" ? (
                      <select
                        aria-label="Nivel mínimo"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={r.minLevel}
                        onChange={(e) =>
                          updateReq(i, { minLevel: Number(e.target.value) })
                        }
                      >
                        {[1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : r.type === "experience_years" ? (
                      <Input
                        type="number"
                        min={0}
                        value={r.minYears ?? 1}
                        onChange={(e) =>
                          updateReq(i, { minYears: Number(e.target.value) })
                        }
                      />
                    ) : (
                      <Input
                        type="number"
                        step="0.1"
                        min={0.1}
                        max={1}
                        value={r.weight}
                        onChange={(e) =>
                          updateReq(i, { weight: Number(e.target.value) })
                        }
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Peso</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0.1}
                      max={1}
                      value={r.weight}
                      onChange={(e) =>
                        updateReq(i, { weight: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={r.isMustHave}
                        onChange={(e) =>
                          updateReq(i, { isMustHave: e.target.checked })
                        }
                      />
                      Must
                    </label>
                    {reqs.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-8"
                        aria-label="Quitar requisito"
                        onClick={() =>
                          setReqs(reqs.filter((_, idx) => idx !== i))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                  {r.type === "experience_years" && (
                    <p className="col-span-full text-xs text-muted-foreground">
                      Se compara contra los años totales detectados en el CV.
                    </p>
                  )}
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                setReqs([
                  ...reqs,
                  {
                    type: "skill",
                    label: "",
                    minLevel: 3,
                    weight: 1,
                    isMustHave: false,
                  },
                ])
              }
            >
              <Plus className="size-4" />
              Añadir requisito
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !description.trim()}
          >
            Crear vacante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ── Subir CVs a una vacante ──────────────────────────────────────────── */
function UploadCvsDialog({
  jobId,
  open,
  onOpenChange,
  onDone,
}: {
  jobId: Id<"jobs">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const initUpload = useMutation(api.applications.initUpload);
  const finalizeUpload = useMutation(api.applications.finalizeUpload);
  const ingestCv = useAction(api.applications.ingestCv);
  const [candidateName, setCandidateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  async function handleFiles(files: FileList) {
    if (!candidateName.trim()) {
      setError("Escribe el nombre del candidato.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const invalid = validateCvFile(file);
        if (invalid) throw new Error(invalid);
        const { uploadUrl } = await initUpload({
          jobId,
          fileName: file.name,
          fileSize: file.size,
        });
        const storageId = await uploadToConvexStorage(uploadUrl, file);
        const { applicationId } = await finalizeUpload({
          jobId,
          storageId: storageId as Id<"_storage">,
          fileName: file.name,
          fileSize: file.size,
          candidateName,
        });
        onDone();
        void ingestCv({ applicationId });
        setDone((d) => d + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir CVs de candidatos</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cand-name">Nombre del candidato</Label>
            <Input
              id="cand-name"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="Ej. Ana García"
            />
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground hover:bg-muted/40">
            <FileText className="size-5" />
            <span>
              {busy
                ? `Subiendo… (${done} listos)`
                : "Haz clic o suelta archivos aquí"}
            </span>
            <span className="text-xs">
              PDF, DOCX o TXT · máx {MAX_CV_MB} MB · análisis IA + matching
            </span>
            <input
              type="file"
              multiple
              accept={ACCEPTED_CV_TYPES}
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {done > 0 && !busy && (
            <p className="text-sm text-muted-foreground">
              {done} archivo(s) en proceso. El matching aparece al terminar.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** ── Detalle de aplicación con match + decisión + notas ────────────────── */
function ApplicationDetail({
  jobId,
  applicationId,
  onBack,
}: {
  jobId: Id<"jobs">;
  applicationId: Id<"applications">;
  onBack: () => void;
}) {
  const job = useQuery(api.jobs.get, { jobId });
  const match = useQuery(api.matches.getForApplication, { applicationId });
  const notes = useQuery(api.applications.notesFor, { applicationId });
  const apps = useQuery(api.applications.listByJob, { jobId });
  const decide = useMutation(api.applications.decide);
  const addNote = useMutation(api.applications.addNote);

  const [note, setNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const application = useMemo(
    () => apps?.find((a) => a.application._id === applicationId)?.application,
    [apps, applicationId],
  );

  async function doDecision(status: "shortlisted" | "rejected" | "pending", noteText?: string) {
    setError(null);
    try {
      await decide({
        applicationId,
        status,
        note: noteText,
      });
      setRejectOpen(false);
      setRejectReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar.");
    }
  }

  async function saveNote() {
    if (!note.trim()) return;
    try {
      await addNote({ applicationId, body: note });
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  if (!application) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Cargando aplicante…
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Volver a la vacante
      </Button>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {application.fullName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {application.structured?.headline ?? "Sin titular detectado"} ·{" "}
            {application.fileName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={application.status} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void doDecision("shortlisted")}
            disabled={application.status === "shortlisted"}
          >
            <Check className="size-4" />
            Preseleccionar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRejectOpen(true)}
            disabled={application.status === "rejected"}
          >
            <X className="size-4" />
            Rechazar
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        {/* Matching explicable */}
        <section aria-label="Match con la vacante">
          <h3 className="text-sm font-semibold">
            Match con la vacante
            {match && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                motor determinista · {match.engineVersion}
              </span>
            )}
          </h3>

          {match === undefined ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Procesando CV…
            </p>
          ) : match === null ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Aún no hay match: el análisis sigue en curso o falló. Reintenta la
              ingesta si quedó en error.
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-4xl font-semibold tabular-nums">
                  {match.overall}
                </span>
                <span className="text-sm text-muted-foreground">/100 global</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MatchBar label="Skills" value={match.skills} />
                <MatchBar label="Experiencia" value={match.experience} />
                <MatchBar label="Educación" value={match.education} />
              </div>

              <h4 className="mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Evidencia por requisito
              </h4>
              <ul className="mt-2 space-y-3">
                {match.requirements.map((r) => (
                  <li
                    key={r.requirementId}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{r.label}</p>
                      <Badge variant={r.met ? "default" : "secondary"}>
                        {r.score}%
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.evidence}
                    </p>
                    {r.gap && (
                      <p className="mt-1 text-xs text-destructive/90">{r.gap}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Este puntaje es una recomendación de apoyo. La decisión final es
                siempre humana y queda registrada con tu autoría.
              </p>
            </>
          )}
        </section>

        {/* Notas + CV estructurado */}
        <section aria-label="Notas y datos" className="space-y-8">
          <div>
            <h3 className="text-sm font-semibold">Notas del equipo</h3>
            <div className="mt-3 flex gap-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Añadir nota…"
                onKeyDown={(e) => e.key === "Enter" && void saveNote()}
              />
              <Button variant="outline" size="sm" onClick={() => void saveNote()}>
                Guardar
              </Button>
            </div>
            <ul className="mt-4 space-y-3">
              {notes?.map((n) => (
                <li key={n._id} className="text-sm">
                  <p>{n.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.authorName} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
              {notes && notes.length === 0 && (
                <li className="text-sm text-muted-foreground">Sin notas aún.</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Perfil detectado</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Experiencia</dt>
                <dd>
                  {application.structured?.yearsExperience ?? "—"} años ·{" "}
                  {application.structured?.experience.length ?? 0} puestos
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Skills</dt>
                <dd>
                  {application.structured?.skills
                    .slice(0, 6)
                    .map((s) => s.name)
                    .join(", ") || "—"}
                  {(application.structured?.skills.length ?? 0) > 6 && "…"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Educación</dt>
                <dd>
                  {application.structured?.education[0]?.degree ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Certificaciones</dt>
                <dd>{application.structured?.certifications.length ?? 0}</dd>
              </div>
            </dl>
            {job?.job.status === "open" && (
              <p className="mt-4 text-xs text-muted-foreground">
                Vacante abierta · creada por el equipo de {job.job.title}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Diálogo de rechazo con nota obligatoria */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar candidatura</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="reject-reason">Motivo (obligatorio)</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ej. No cubre el nivel de inglés requerido para el rol."
            />
            <p className="text-xs text-muted-foreground">
              El motivo queda en el historial del proceso (auditoría interna).
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => void doDecision("rejected", rejectReason)}
              disabled={!rejectReason.trim()}
            >
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** ── Página principal del área empresa ────────────────────────────── */
export default function Org() {
  const { orgId, jobId, appId } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const orgs = useQuery(api.orgs.myOrgs);
  const createOrg = useMutation(api.orgs.create);

  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeOrgId = orgId as Id<"organizations"> | undefined;
  const jobs = useQuery(
    api.jobs.listByOrg,
    activeOrgId ? { organizationId: activeOrgId } : "skip",
  );

  const activeOrg = orgs?.find((o) => o._id === activeOrgId);

  async function handleCreateOrg() {
    setError(null);
    try {
      const { organizationId } = await createOrg({ name: orgName });
      setNewOrgOpen(false);
      setOrgName("");
      navigate(`/org/${organizationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear.");
    }
  }

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard")}
            >
              <LayoutDashboard className="size-4" />
              Candidato
            </Button>
            <span className="text-border">|</span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="size-4 text-muted-foreground" />
              Empresa
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="size-4" />
            Salir
          </Button>
        </header>

        {/* Selección / creación de organización */}
        {orgs === undefined ? (
          <div className="py-24 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-border">
              <Building2 className="size-6 text-muted-foreground" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">
              Crea tu organización
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Publica vacantes, sube CVs y evalúa candidatos con match scores
              explicables. La IA es apoyo: la decisión siempre es tuya.
            </p>
            <Button className="mt-8" onClick={() => setNewOrgOpen(true)}>
              <Plus className="size-4" />
              Crear organización
            </Button>
          </div>
        ) : (
          <>
            <div className="hairline-b mt-10 flex flex-wrap items-center justify-between gap-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                {orgs.map((o) => (
                  <Button
                    key={o._id}
                    variant={o._id === activeOrgId ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => navigate(`/org/${o._id}`)}
                  >
                    {o.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {o.myRole}
                    </span>
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNewOrgOpen(true)}
                >
                  <Plus className="size-4" />
                  Nueva
                </Button>
              </div>
            </div>

            {activeOrgId && (
              <div className="mt-8">
                {jobId && appId ? (
                  <ApplicationDetail
                    jobId={jobId as Id<"jobs">}
                    applicationId={appId as Id<"applications">}
                    onBack={() => navigate(`/org/${activeOrgId}/job/${jobId}`)}
                  />
                ) : jobId ? (
                  <JobApplicants
                    orgId={activeOrgId}
                    jobId={jobId as Id<"jobs">}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                          Vacantes
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {activeOrg?.name}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setNewJobOpen(true)}>
                        <Plus className="size-4" />
                        Nueva vacante
                      </Button>
                    </div>

                    {jobs === undefined ? (
                      <p className="mt-8 text-sm text-muted-foreground">
                        Cargando vacantes…
                      </p>
                    ) : jobs.length === 0 ? (
                      <div className="mt-16 text-center">
                        <p className="text-sm text-muted-foreground">
                          Sin vacantes todavía. Crea la primera y empieza a
                          cargar CVs.
                        </p>
                      </div>
                    ) : (
                      <ul className="mt-8 grid gap-4 md:grid-cols-2">
                        {jobs.map((j) => (
                          <li key={j._id}>
                            <Card
                              className="cursor-pointer border-border shadow-none transition-colors hover:bg-muted/40"
                              onClick={() =>
                                navigate(`/org/${activeOrgId}/job/${j._id}`)
                              }
                            >
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base">
                                    {j.title}
                                  </CardTitle>
                                  <Badge
                                    variant={
                                      j.status === "open"
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {j.status === "open" ? "Abierta" : "Cerrada"}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="text-sm text-muted-foreground">
                                {[j.seniority, j.location]
                                  .filter(Boolean)
                                  .join(" · ") || "Sin detalles"}
                              </CardContent>
                            </Card>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Crear organización */}
      <Dialog open={newOrgOpen} onOpenChange={setNewOrgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva organización</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="org-name">Nombre</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Ej. Acme Corp"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              onClick={() => void handleCreateOrg()}
              disabled={orgName.trim().length < 2}
            >
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewJobDialog
        organizationId={activeOrgId!}
        open={newJobOpen}
        onOpenChange={setNewJobOpen}
        onCreated={() => {}}
      />
    </main>
  );
}

/** ── Aplicantes de una vacante ───────────────────────────────── */
function JobApplicants({
  orgId,
  jobId,
}: {
  orgId: Id<"organizations">;
  jobId: Id<"jobs">;
}) {
  const job = useQuery(api.jobs.get, { jobId });
  const apps = useQuery(api.applications.listByJob, { jobId });
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);

  const processing = apps?.some(
    (a) =>
      a.application.extractStatus === "processing" ||
      a.application.extractStatus === "uploaded",
  );

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/org/${orgId}`)}
      >
        <ArrowLeft className="size-4" />
        Vacantes
      </Button>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {job === undefined ? "Vacante…" : (job?.job.title ?? "Vacante")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {[job?.job.seniority, job?.job.location].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Plus className="size-4" />
          Subir CVs
        </Button>
      </div>

      {apps === undefined ? (
        <p className="mt-10 text-sm text-muted-foreground">Cargando aplicantes…</p>
      ) : apps.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">
            Sin aplicantes todavía. Sube CVs y el matching aparecerá aquí.
          </p>
        </div>
      ) : (
        <>
          {processing && (
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5 animate-pulse" />
              Hay CVs en análisis. La lista se actualiza sola.
            </p>
          )}
          <ul className="mt-6 divide-y divide-border rounded-md border border-border">
            {apps.map(
              (item: {
                application: {
                  _id: Id<"applications">;
                  fullName: string;
                  status: string;
                  extractStatus: string;
                  failureReason?: string;
                  structured?: {
                    headline?: string;
                  } | null;
                };
                match: { overall: number } | null;
              }) => {
                const application = item.application;
                const match = item.match;
                return (
                  <li key={application._id}>
                    <button
                      className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40"
                      onClick={() =>
                        navigate(
                          `/org/${orgId}/job/${jobId}/app/${application._id}`,
                        )
                      }
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <div
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold tabular-nums"
                        >
                          {match ? match.overall : "–"}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {application.fullName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {application.extractStatus === "failed"
                              ? application.failureReason ?? "Error de análisis"
                              : application.extractStatus === "ready"
                                ? application.structured?.headline ?? "Sin titular"
                                : "Analizando CV…"}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={application.status} />
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        </>
      )}

      <UploadCvsDialog
        jobId={jobId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onDone={() => {}}
      />
    </div>
  );
}
