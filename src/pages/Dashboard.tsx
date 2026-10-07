
function nextActionFromGap(
  gap: GapResult | undefined,
  profile: Profile | null | undefined,
  targetValue: string | null,
): string {
  if (!gap || !profile || !targetValue) {
    return profile
      ? "Define un objetivo profesional para ver tu siguiente acción."
      : "Sube tu CV para comenzar.";
  }
  const skills = gap.analysis.skills;
  const gaps = skills.filter((s) => s.status === "gap");
  const weak = skills.filter(
    (s) => s.status === "missing_evidence" || s.status === "insufficient_evidence",
  );
  if (gaps.length === 0 && weak.length === 0) {
    return `Tu perfil cubre los requisitos registrados para ${targetValue}. Estás en condiciones de perseguirlo con la evidencia actual.`;
  }
  if (gaps.length > 0) {
    const top = gaps.slice().sort((a, b) => b.requiredLevel - a.requiredLevel)[0];
    return `Fortalece ${top.skill}: tienes nivel ${top.currentLevel ?? 0} pero ${targetValue} pide ${top.requiredLevel}. ${top.explanation}`;
  }
  const top = weak[0];
  if (top.status === "missing_evidence") {
    return `Registra ${top.skill}: no tenemos evidencia de esta habilidad en tu perfil (no decimos que no sepas hacerlo — aún no lo tenemos registrado). ${top.explanation}`;
  }
  return `Revisa ${top.skill}: la detección es de baja confianza. Corrígela para que cuente como evidencia. ${top.explanation}`;
}

function Carrera({
  profile,
  goals,
  targetGoal,
  gap,
  roles,
  setGoal,
  removeGoal,
  regenerate,
}: {
  profile: Profile;
  goals: Doc<"careerGoals">[] | null | undefined;
  targetGoal: Doc<"careerGoals"> | null;
  gap: GapResult | undefined;
  roles: RoleMatch[] | undefined;
  setGoal: (args: {
    kind: "target_role" | "aspiration" | "goal";
    value: string;
    skills?: GoalSkillInput[];
    source?: "user-provided" | "system-derived" | "ai-generated" | "proposed" | "verified";
  }) => Promise<{ _id: Id<"careerGoals"> | void; action: "created" | "updated" }>;
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

  function openNew() {
    setEditValue("");
    const t = suggested;
    setUseTemplate(!!t);
    setTemplateSkills(t ? roleSkillsAsRequired(t) : []);
    setEditing(true);
  }

  function openEdit() {
    if (!targetGoal) return;
    setEditValue(targetGoal.value);
    const m = findRoleTemplateByLabel(targetGoal.value);
    setUseTemplate(!!m);
    setTemplateSkills(m ? roleSkillsAsRequired(m) : (targetGoal.skills as unknown as GoalSkillInput[]));
    setEditing(true);
  }

  async function save() {
    if (!editValue.trim() || busy) return;
    setBusy(true);
    try {
      await setGoal({
        kind: "target_role",
        value: editValue.trim(),
        skills: useTemplate && templateSkills.length > 0 ? templateSkills : [],
        source: "user-provided",
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!targetGoal || removing) return;
    setRemoving(true);
    try {
      await removeGoal({ goalId: targetGoal._id });
    } finally {
      setRemoving(false);
    }
  }

  async function refreshGap() {
    if (!targetGoal) return;
    void regenerate({ targetId: targetGoal._id });
  }

  const skillsList = targetGoal?.skills ?? [];
  const coverage = gap?.analysis.overallCoverage;
  const gapSkills = gap?.analysis.skills ?? [];
  const gapOnly = gapSkills.filter((s) => s.status === "gap");
  const weakSkills = gapSkills.filter(
    (s) => s.status === "missing_evidence" || s.status === "insufficient_evidence",
  );

  const metSkills = gapSkills.filter((s) => s.status === "meets_requirement");
  void gapSkills;
  void skillsList;
  void metSkills;
  void gapOnly;
  void weakSkills;

  return (
    <section aria-labelledby="carrera-title" className="mt-12">
      <div className="hairline-b pb-4">
        <p className="eyebrow">Tu carrera</p>
        <h2 id="carrera-title" className="mt-1 text-xl font-semibold">
          De tu CV a tu siguiente paso
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Elige un puesto que te interese y te mostramos qué tienes, qué te
          falta y qué puestos son compatibles con tu evidencia actual.
        </p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <div className="space-y-8">
          {targetGoal ? (
            <section aria-labelledby="objetivo-title">
              <h3 id="objetivo-title" className="text-sm font-semibold">
                Tu objetivo profesional
              </h3>
              <div className="mt-3 rounded-lg border border-border bg-card p-4">
                <p className="text-lg font-medium">{targetValue}</p>
                {skillsList.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skillsList.map((s) => (
                      <Badge key={s.name} variant="secondary" className="gap-1.5">
                        {s.name} · nivel {(s as GoalSkillInput).requiredLevel}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit()}>
                    <Pencil className="size-4" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void refreshGap()} disabled={busy}>
                    <RefreshCw className="size-4" />
                    Recalcular
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove()}
                    disabled={removing || busy}
                  >
                    <Trash className="size-4" />
                    Eliminar objetivo
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <section aria-labelledby="objetivo-title">
              <h3 id="objetivo-title" className="text-sm font-semibold">
                Define tu objetivo profesional
              </h3>
              {editing ? (
                <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-3">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="P. ej. Senior Frontend Developer"
                    maxLength={120}
                    autoFocus
                  />
                  {suggested && (
                    <p className="text-sm text-muted-foreground">
                      Coincide con: <span className="font-medium">{suggested.label}</span> — {suggested.description}
                    </p>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useTemplate}
                      disabled={!suggested}
                      onChange={(e) => setUseTemplate(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-input"
                    />
                    <span>
                      Usar requisitos de referencia({suggested ? suggested.label : "personalizados"})
                      {useTemplate && templateSkills.length > 0 && (
                        <span className="text-muted-foreground"> · {templateSkills.length} skills</span>
                      )}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void save()}
                      disabled={busy || !editValue.trim() || (suggested && !useTemplate)}
                    >
                      <Check className="size-4" />
                      Guardar objetivo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="¿Qué puesto quieres conseguir?"
                    maxLength={120}
                  />
                  {suggested && (
                    <p className="text-sm text-muted-foreground">
                      Encontramos referencia: <span className="font-medium">{suggested.label}</span> — {suggested.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-sm">
                    {ROLE_TEMPLATES.slice(0, 6).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setEditValue(r.label)}
                        className="rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setUseTemplate(!!suggested);
                      setTemplateSkills(suggested ? (roleSkillsAsRequired(suggested) as GoalSkillInput[]) : []);
                      setEditing(true);
                    }}
                    disabled={busy || !editValue.trim()}
                  >
                    <Plus className="size-4" />
                    Avanzar con esto
                  </Button>
                </div>
              )}
            </section>
          )}

          {gap && profile ? (
            <section aria-labelledby="brecha-title">
              <h3 id="brecha-title" className="text-sm font-semibold">
                Tu brecha para {targetValue ?? "..."}
              </h3>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums">{coverage}</span>
                <span className="text-sm text-muted-foreground">% de requisitos cubiertos</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {gapSkills.length} requisito(s) evaluado(s) con tu evidencia actual.
              </p>

              <div className="mt-4 space-y-5">
                {metSkills.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-green-600">Lo que ya tienes</p>
                    <ul className="mt-2 space-y-2">
                      {metSkills.map((s) => (
                        <li key={s.skill} className="flex gap-3 text-sm">
                          <Check className="mt-0.5 size-4 shrink-0 text-green-600" />
                          <div>
                            <p className="font-medium">{s.skill}</p>
                            <p className="text-muted-foreground">Nivel {s.currentLevel} ≥ {s.requiredLevel} requerido.</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {gapOnly.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Para llegar ahí</p>
                    <ul className="mt-2 space-y-2">
                      {gapOnly.map((s) => (
                        <li key={s.skill} className="flex gap-3 text-sm">
                          <span className="mt-0.5 shrink-0 text-sm font-medium">△</span>
                          <div>
                            <p className="font-medium">{s.skill}</p>
                            <p className="text-muted-foreground">Nivel {s.currentLevel} &lt; {s.requiredLevel} requerido. {s.explanation}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {weakSkills.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-amber-600">Falta evidencia</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No decimos que no sepas hacerlo: aún no tenemos registro o la detección es de baja confianza. Agrega la experiencia o corrige el nivel.
                    </p>
                    <ul className="mt-2 space-y-2">
                      {weakSkills.map((s) => (
                        <li key={s.skill} className="flex gap-3 text-sm">
                          <span className="mt-0.5 shrink-0 text-sm">○</span>
                          <div>
                            <p className="font-medium">{s.skill}</p>
                            <p className="text-muted-foreground">{s.explanation}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {metSkills.length === 0 && gapOnly.length === 0 && weakSkills.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin requisitos registrados para este objetivo.</p>
                )}
              </div>
            </section>
          ) : (
            <section aria-labelledby="brecha-title">
              <h3 id="brecha-title" className="text-sm font-semibold">Tu brecha</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {profile ? "Define un objetivo profesional para ver qué te hace falta." : "Sube tu CV para comenzar."}
              </p>
            </section>
          )}

          <section aria-labelledby="next-title">
            <h3 id="next-title" className="text-sm font-semibold">Tu siguiente acción</h3>
            <div className="mt-3 rounded-lg border border-border bg-card p-4">
              <p className="text-sm leading-6">{nextActionFromGap(gap, profile, targetValue)}</p>
              {(gapSkills.some((s) => s.status === "gap" || s.status === "missing_evidence" || s.status === "insufficient_evidence") || metSkills.length === 0) && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void refreshGap()} disabled={busy}>
                    <RefreshCw className="size-4" />
                    Recalcular
                  </Button>
                  <Button asChild>
                    <a href="/dashboard?tab=coach" className="flex items-center gap-2">
                      <Sparkles className="size-4" />
                      Preguntar al coach
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section aria-labelledby="roles-title">
            <h3 id="roles-title" className="text-sm font-semibold">Roles compatibles</h3>
            {roles && roles.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {roles.map((r) => (
                  <li key={r.roleId} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{r.label}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{r.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`text-lg font-semibold tabular-nums ${
                            r.match.overall >= 70 ? "text-green-600" : r.match.overall >= 45 ? "text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          {r.match.overall}%
                        </span>
                        <p className="text-xs text-muted-foreground">match</p>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {r.match.requirements.slice(0, 5).map((req) => (
                        <li key={req.requirementId} className="flex gap-2 text-sm">
                          {req.met ? (
                            <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                          ) : (
                            <span className="mt-0.5 shrink-0 text-sm">△</span>
                          )}
                          <span className="truncate">
                            <span className="font-medium">{req.label}</span> {" "}
                            <span className="text-muted-foreground">{req.score}/100</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-card p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {profile ? "Sube tu CV para ver roles compatibles." : "Sube tu CV para comenzar."}
                </p>
              </div>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Los match son deterministas y explican qué cumple y qué falta. No es una promesa de resultado ni una decisión de contratación.
          </p>
        </div>
      </div>

      {editing && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">{targetGoal ? "Editar objetivo" : "Nuevo objetivo"}</h3>
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="P. ej. Senior Frontend Developer"
            maxLength={120}
            autoFocus
          />
          {suggested && !targetGoal && (
            <p className="text-sm text-muted-foreground">
              Coincide con: <span className="font-medium">{suggested.label}</span> — {suggested.description}
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={useTemplate}
              disabled={!suggested && !targetGoal}
              onChange={(e) => setUseTemplate(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-input"
            />
            <span>
              Usar requisitos de referencia({suggested ? suggested.label : targetGoal ? "actuales" : "personalizados"})
              {useTemplate && templateSkills.length > 0 && (
                <span className="text-muted-foreground"> · {templateSkills.length} skills</span>
              )}
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={busy || !editValue.trim() || (suggested && !useTemplate)}
            >
              <Check className="size-4" />
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

type GapSkill = {
  skill: string;
  requiredLevel: number;
  currentLevel?: number;
  status:
    | "meets_requirement"
    | "gap"
    | "missing_evidence"
    | "insufficient_evidence";
  evidenceRefs: string[];
  explanation: string;
};

type GapResult = {
  _id: Id<"gapAnalyses">;
  analysis: {
    targetId: string;
    engineVersion: string;
    generatedAt: number;
    overallCoverage: number;
    skills: GapSkill[];
  };
  computedAt: number;
};

type GoalSkillInput = {
  name: string;
  requiredLevel: number;
  category?: string;
};

type RoleMatch = {
  roleId: string;
  label: string;
  description: string;
  matchVersion: string;
  match: {
    overall: number;
    skills: number;
    experience: number;
    education: number;
    requirements: Array<{
      requirementId: string;
      label: string;
      met: boolean;
      score: number;
      evidence: string;
      gap?: string;
    }>;
    engineVersion: string;
  };
};

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery(api.candidates.myProfile);
  const resumes = useQuery(api.candidates.myResumes);
  const diagnosis = useQuery(api.candidates.diagnosis);

  const [tab, setTab] = useState<"cv" | "diagnostico" | "coach" | "carrera">(
    "diagnostico",
  );

  const goals = useQuery(api.career.myCareerGoals);
  const targetGoal = targetGoalFromGoals(goals);
  const gap = useQuery(
    api.career.myGapAnalysis,
    targetGoal ? { targetId: targetGoal._id } : "skip",
  );
  const roles = useQuery(api.career.compatibleRoles, { limit: 6 });
  const setGoal = useMutation(api.career.setCareerGoal);
  const removeGoal = useMutation(api.career.removeCareerGoal);
  const regenerate = useMutation(api.career.regenerateGapAnalysis);

  const activeVersions: Doc<"resumeVersions">[] = useMemo(() => {
    if (!resumes) return [];
    return (resumes as ResumeGroup[]).flatMap((r) => r.versions);
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
                  ["coach", "Coach"],
                  ["carrera", "Carrera"],
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
              {tab === "cv" && <MiCv profile={profile} />}
              {tab === "coach" && <Coach />}
              {tab === "carrera" && <Carrera profile={profile} goals={goals} targetGoal={targetGoal} gap={gap} roles={roles} setGoal={setGoal} removeGoal={removeGoal} regenerate={regenerate} />}
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
