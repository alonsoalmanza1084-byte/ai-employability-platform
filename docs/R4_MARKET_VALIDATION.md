# R4 — MARKET VALIDATION REPORT

**Versión:** 1.0 · **Fecha:** 2026-10-06 · **Estado:** Validación por investigación secundaria — **wedge CANDIDATO, no definitivo**
**Regla de fase:** este incremento NO modifica código. Contrato `rejectProposal` (internal) / `rejectProposalByOwner` (público) intacto.

---

## Fuentes de evidencia (investigación de mercado, oct-2026)

| # | Evidencia | Fuente |
|---|---|---|
| E1 | Coste por contratación no ejecutiva EE. UU. **$5.475** (SHRM 2025 Benchmarking); coste total de contratar estimado en **3–4× el salario** del puesto | SHRM / Edie Goldberg |
| E2 | Solo el **36%** de las organizaciones son «career development champions»; solo el **24%** tiene movilidad interna estructurada; solo el **11%** de los champions EMEA tiene un líder dedicado de movilidad interna | LinkedIn Workplace Learning Report 2025 |
| E3 | Adopción de talento basado en skills: **41%** ha adoptado algún proceso, **50%** lo considera pero no ha empezado; solo ~**5%** de empresas incorpora datos de skills de forma rutinaria | Gartner (doc. distribuido por Eightfold) / McKinsey |
| E4 | Los tres líderes de talent marketplace (**Gloat, Fuel50, Eightfold**) fallan de forma sistemática en adopción de managers: «None of them have solved it completely»; pricing **quote-only** para los tres | hrtechsaas.com, comparativa de practicantes, jul-2026 |
| E5 | Eightfold: **seis cifras**, empresas de **10.000+** empleados, implementación de **meses**; estimaciones de precio **$7–10/empleado/mes** + implementación aparte ($5K–$50K) | Engagedly 2026, Voyse 2026, ITQlick |
| E6 | Datos por inferencia: Gloat «imprecisa» para títulos ambiguos; Eightfold «más rica… **más difícil de auditar**» (tabla comparativa de la misma fuente E4) | hrtechsaas jul-2026 |
| E7 | Quejas de categoría en G2: pros «Ease of Use (217 menciones)» vs **«Limited Customization (83)»** como principal con; Cornerstone «curva de aprendizaje pronunciada»; Fuel50 «pricing refleja inversión enterprise» | G2 (comparativas ago-2026), Research.com |
| E8 | **EU AI Act Anexo III Cat. 4** (empleo): obligaciones de sistemas de alto riesgo **vinculantes desde 2 ago 2026** — supervisión humana en la arquitectura (Art. 14), logging, sin decisión final automática | artificialintelligenceact.eu, CSA, guías de cumplimiento 2026 |
| E9 | El workaround real del mid-market son **plantillas de career path (Excel)** y 1:1 manuales: bob, Insperity, Great Place to Work, Quantum Workplace, r/humanresources | blogs de plantillas + Reddit HR |
| E10 | 55% de líderes (encuesta Workday, 2.300) ya inició la transición a talento basado en skills; BCG: éxito = «resistir el impulso de hacer demasiado de golpe» | Deloitte (abr-2026), BCG (jul-2025) |

**Sesgos declarados:** E3 procede parcialmente de un PDF alojado por Eightfold (contenido Gartner); E5 son estimaciones de analistas tier-3, no precios publicados. Toda la evidencia es **secundaria**: requiere validación primaria (entrevistas/pilotos) antes de declarar wedge definitivo.

---

## A. Competitive analysis (≥5)

| Competidor | Qué resuelve | Para quién | Precio/contrato | Debilidad documentada |
|---|---|---|---|---|
| **Eightfold AI** | Talent intelligence interna+externa con un solo modelo de inferencia LLM | Enterprise 10.000+ empleados | Quote-only, 6 cifras, $7–10/emp/mes estimado, meses de implementación | Datos «más difíciles de auditar» (E6); complejidad de implementación; fuera del mid-market (E5) |
| **Gloat** | Marketplace interno de talento: proyectos/gigs, agilidad de workforce | Grandes empresas matriciadas | Quote-only (E4) | Inferencia imprecisa (E6); depende de cultura de proyectos; adopción de managers en orgs silotadas (E4) |
| **Fuel50** | Arquitectura de skills gobernada (taxonomía con revisión de I/O psych) + career pathing | Mid-to-large | Quote-only, pricing enterprise (E7) | Configuración inicial; sin señal de mercado externo; sigue sin resolver adopción de managers (E4) |
| **Workday (HCM)** | Skills/Talent marketplace dentro del HCM incumbent | Clientes Workday | Bundled en contrato HCM | Solo si ya eres cliente Workday; «steep learning curve» en módulos de talent (E7) |
| **Degreed** | LXP: consumo y reporting de aprendizaje/upskilling | L&D enterprise | Quote-only; ratings 4.3–4.4 (Gartner Peer Insights) | Resuelve «contenido», no decisiones de movilidad con evidencia |
| **Cornerstone** | Suite legacy de learning + performance + talent | Enterprise | Sin pricing público; queja: curva de aprendizaje | Legacy UX; no es evidencia trazable |
| **Beamery / Phenom** | Talent CRM / talent experience para recruiting externo | Enterprise TA | Quote-only | Fuera del flujo de desarrollo interno del empleado |

**Categoría:** talent marketplace / skills intelligence / career development. Ninguno publica precios; todos venden por cifras de contrato e integración con HCM.

## B. ICP (candidato — NEEDS_VALIDATION)

- **Company size:** 200–2.000 empleados (mid-market) **sin Workday/SAP SuccessFactors** (el incumbent no los atiende y los quote-only de 6 cifras no encajan).
- **Industrias:** fintech/healthtech, servicios profesionales, software, logística — reguladas o con presión de retención y auditoría de decisiones asistidas por IA.
- **Buyer:** VP People / Head of Talent / Head of L&D (CHRO si existe); **budget owner** = VP People.
- **User primario:** empleado (perfil y plan); **user secundario crítico:** people manager (conversación de desarrollo 1:1).
- **Pain:** conversaciones de desarrollo genéricas, planes que nadie ejecuta, skills en spreadsheets, contratación externa por defecto, cero evidencia para decidir movilidad.
- **Current workaround:** plantillas Excel de career path, módulos de performance del HRIS, LinkedIn Learning, 1:1 por intuición, recruiting externo directo.
- **Presupuesto:** línea de L&D/talent mobility; decisiones <25K USD/año fuera del ciclo de procurement enterprise.

## C. Jobs-to-be-Done (3–5 críticos)

1. **JTBD-1 (empleado):** «Dime con evidencia qué me falta para el rol al que aspiro y dame un plan que yo controle».
2. **JTBD-2 (manager):** «Dame estructura y evidencia para una conversación de desarrollo real en mi 1:1, sin convertirme en HR».
3. **JTBD-3 (VP People/Talent):** «Convierte esas conversaciones en planes medibles y en movilidad interna antes de abrir una vacante externa».
4. **JTBD-4 (compliance/audit):** «Que toda recomendación asistida por IA sea trazable, con evidencia, supervisión humana y log — exigible desde ago-2026 (EU AI Act)».
5. **JTBD-5 ( People Analytics, fase posterior):** «Agregados de skills/gaps por organización sin exponer datos individuales».

## D. Value proposition (frase)

> For **mid-market companies (200–2.000 employees) without an enterprise HCM** who struggle with **generic career conversations and skills trapped in spreadsheets — so they default to external hiring**, this product provides **evidence-backed development plans and measurable internal mobility** by **converting career conversations into claims → evidence → human-confirmed proposals with a full audit trail**, unlike **quote-only enterprise suites (Eightfold/Gloat/Fuel50) that take months and six figures, or Excel templates with no evidence**.

## E. Product wedge (CANDIDATO — no declarar definitivo)

**«Convertir conversaciones de desarrollo profesional en planes de movilidad interna medibles para empresas medianas.»**

Conecta exactamente los activos existentes: `Coach (conversación) → propuesta (pending/rejected, humana) → evidencia trazable → (siguiente incremento) Career Profile + Gap Analysis → Development Plan → Target Role`.

**Por qué encaja con la evidencia:** ataca el fallo sistémico documentado (adopción de managers, E4), el hueco de precio/velocidad del mid-market (E5/E7), la queja de personalización/auditabilidad (E6/E7) y la presión regulatoria de supervisión humana (E8).

**Señales que lo desmentirían (kill criteria):** entrevistas donde el buyer diga que el problema es sourcing externo, no desarrollo; managers que rechacen hacer 1:1 con la herramienta; willingness-to-pay <4 USD/empleado/mes.

## F. KPIs de negocio (3–5)

1. **North star:** % de conversaciones de desarrollo que terminan en un **plan con next-action confirmado por el usuario** (conversation → confirmed plan conversion).
2. **Proposal action rate:** propuestas `pending` que el usuario actiona (confirma/rechaza con motivo) — proxy de valor inmediato.
3. **Internal mobility rate / internal fill rate** y **time-to-fill** (valor económico; requiere cohortes cliente).
4. **AI quality:** proposal rejection rate + grounded recommendation rate (calidad del pipeline claim→evidence).
5. **Retención/engagement** de cuenta: % empleados activos mensuales con perfil completo.

## G. Validation plan (antes del siguiente módulo grande)

1. **12–15 entrevistas** (60 min) con VP People/Head of Talent en empresas 200–2.000 (criterio: sin Workday): mapear workaround actual, coste percibido, comprador, disparadores de compra. **Meta:** 8/15 confirman el dolor de «conversaciones genéricas → contratación externa por defecto».
2. **Test de demanda:** landing + demo concierge del flujo Coach→Plan (video), CTA «piloto de 30 días»; **meta:** 15 MQLs cualificados con empresa.
3. **Piloto concierge (2 clientes diseño):** 4–6 semanas, 20–50 empleados; medir conversión conversación→plan y uso de managers.
4. **Pricing (Van Westendorp en entrevistas):** validar banda 4–8 USD/empleado/mes + tier enterprise; NO publicar precios antes.
5. **Revisión legal** de copy (EU AI Act Art. 14/22, sin decisión automatizada, disclosures ya presentes en PRD §8).

---

# REPORTE OBLIGATORIO (§28)

**ICP:** Empresas medianas (200–2.000 empleados) sin HCM enterprise, industrias con presión de retención/auditoría (fintech, healthtech, software, servicios profesionales).

**BUYER:** VP People / Head of Talent / Head of L&D (presupuesto de L&D/talent mobility). **PRIMARY USER:** empleado + people manager (1:1).

**CORE PROBLEM:** Las conversaciones de desarrollo son genéricas y los skills viven en spreadsheets → las empresas recurren a contratar externo en lugar de desarrollar/mover talento interno; cero evidencia trazable para decisiones asistidas por IA.

**CURRENT WORKAROUNDS:** Plantillas Excel de career path; módulos de performance del HRIS; LinkedIn Learning; 1:1 por intuición; req. externo directo.

**TOP COMPETITORS:** Eightfold AI, Gloat, Fuel50, Workday (HCM), Degreed, Cornerstone (+Beamery/Phenom/365Talents fuera del flujo interno).

**UNSERVED GAP:** Mid-market sin opción entre «Excel sin evidencia» y «suites quote-only de 6 cifras con meses de implementación»; además, **adopción de managers no resuelta por ningún líder** y **recomendaciones de IA poco auditables** justo cuando EU AI Act exige supervisión humana vinculante (ago-2026).

**PRODUCT WEDGE (candidato):** Convertir conversaciones de desarrollo profesional en planes de movilidad interna medibles (Coach → evidencia → propuesta humana → plan), para empresas medianas. *No definitivo hasta entrevistas/pilotos (§G).*

**VALUE PROPOSITION:** For mid-market companies without an enterprise HCM who struggle with generic career conversations and skills in spreadsheets — defaulting to external hiring — this product provides evidence-backed development plans and measurable internal mobility by converting career conversations into claim → evidence → human-confirmed proposals with audit, unlike quote-only enterprise suites or Excel templates.

**WHY NOW:** (1) EU AI Act alto riesgo en empleo obligatorio desde 2 ago 2026 → supervisión humana + logging = ya exigible (E8); (2) solo 24% de orgs tiene movilidad interna estructurada y el 50% aún no empezó con skills (E2/E3); (3) coste por contratación en máximos ($5.475 + 3–4× salario) presiona budgets de talent (E1).

**BUSINESS MODEL:** PEPM por empleado activo (banda candidata 4–8 USD, a validar) en tiers Starter/Growth/Enterprise; límites de IA en tiers bajos; sin precios publicados hasta §G.4. *(NEEDS_VALIDATION)*

**NORTH STAR METRIC:** % de conversaciones de desarrollo que terminan en un plan con next-action confirmado por el usuario.

**PRIMARY KPI:** conversión conversación → plan confirmado (y proposal action rate como proxy inmediato).

**SECONDARY KPIs:** internal fill rate / time-to-fill; proposal rejection rate y grounded recommendation rate; % empleados con perfil completo; adopción de managers (1:1 iniciados con la herramienta).

**VALIDATION EVIDENCE:** E1–E10 (arriba). Resumen: dolor de coste real (E1), práctica mayoritariamente inexistente (E2/E3), fallo estructural de incumbentes en managers y auditabilidad (E4/E6), precio/velocidad fuera del mid-market (E5/E7), regulación activa (E8), workaround actual = Excel (E9). **Limitación: evidencia secundaria — sesgos declarados; validación primaria obligatoria (§G).**

**RISKS:** wedge mal elegido sin entrevistas (mitig. §G kill-criteria); incumbentes copian el ángol de evidencia; adopción de managers (el fallo histórico de la categoría) puede extenderse a nosotros; pricing sin validar; dependencia de proveedor LLM (bloqueo actual `BLOCKED_BY_PROVIDER`); datos de empleados = dominio de alto riesgo (privacidad/organizacional); estacionalidad de compra HR.

**RECOMMENDED NEXT INCREMENT:** **R5 — CAREER PROFILE & GAP ANALYSIS (slice vertical delgado, Phase 2)** condicionado a superar §G.1: añadir al perfil profesional `targetRole`/`aspirations`/`goals` (estados **user-provided**) + **Gap Analysis determinista** (**system-derived**, con evidencia existente del diagnóstico y claims) que alimente el Development Plan desde las propuestas del Coach **sin** crear estado `accepted` ni tocar `candidateProfiles` desde IA. Justificación por matriz §3: usuario=empleado+manager; buyer=VP People; problema=JTBD-1/2; frecuencia=semanal (1:1); coste actual=E1/E2; alternativas=Excel/HRIS; diferenciación=evidencia+auditoría (E6/E8); métrica=north star; riesgo=adopción; seguridad=`requireSelf`+ownership+scope de org existente; datos=perfil ya presente.

**DO NOT BUILD (todavía):** marketplace de vacantes internas (fase 3, requiere adopción validada); workforce analytics/agregados (fase 6, sin datos legítimos); RBAC nuevo o roles de manager hasta definir las tres capas de privacidad; billing real antes de validar willingness-to-pay; «aceptar propuesta = aplicar al perfil» (rompería INV-013/ADR-012); dashboards decorativos sin KPI; decisiones automatizadas de promoción/contratación (prohibido, EU AI Act).

**ARCHITECTURAL CONSEQUENCES:** (1) nuevo dominio Career Profile con provenance explícito por campo (`user-provided | system-derived | ai-generated | verified | proposed`); (2) GapAnalysis como derivado determinista versionado, NO como afirmación de IA; (3) frontera de privacidad de tres niveles (private / manager-visible / aggregate) como contrato de autorización explícito — nunca `if user.role === "admin"`; (4) audit de toda generación de plan; (5) mantener `rejectProposal` internal + `rejectProposalByOwner` público como boundary; (6) sin `accepted` hasta decisión de dominio formal (ADR nuevo).

**PRODUCTION STATUS:** `PRODUCTION READY = NO` (gate global, independiente de R4). `R4 IMPLEMENTED = YES` (informe; 0 cambios de código, sin regresión posible). `BLOCKERS = [golden: BLOCKED_BY_PROVIDER, recovery: BLOCKED, edge: BLOCKED deliberado, RBAC/VULN-14: SKIPPED por manifiesto]`. `RISKS = [ver arriba]`. `NEXT STEP = R5 tras entrevistas §G.1 (o re-priorizar si kill-criteria se activan)`.

---

*Principio aplicado (§29): este informe busca un problema empresarial caro y defendible, no más features. El wedge queda CANDIDATO hasta evidencia primaria.*
