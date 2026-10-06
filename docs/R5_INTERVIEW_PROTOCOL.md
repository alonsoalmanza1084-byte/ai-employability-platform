# R5_INTERVIEW_PROTOCOL.md — Market Validation Gate (PHASE B)

> **Estado: PROTOCOL DISEÑADO, ENTREVISTAS = 0/15.**
> Este documento NO declara validación. `MARKET VALIDATED = NO` hasta superar los
> thresholds de §4 con evidencia observable. La investigación secundaria (R4 +
> §5 de este documento) es research, no demanda de compra.
>
> Fuente de verdad complementaria: `docs/R4_MARKET_VALIDATION.md` (ICP, buyer,
> wedge candidato, kill-criteria, §G.1).

---

## 1. Objetivo del gate

Comprobar si el wedge **«Career Development → Evidence → Human-confirmed
Proposal → Internal Mobility»** corresponde a un problema real, frecuente, caro y
presupuestable en empresas de 200–2.000 empleados sin HCM enterprise.

**NO es el objetivo:** vender, mostrar demo, obtener cumplidos ni validar la
idea del producto.

## 2. Reglas de oro del entrevistador

1. NO vender el producto. NO enseñar demo en la primera entrevista.
2. NO preguntar «¿usarías esta plataforma?» ni «¿te parece buena idea?».
3. Buscar **comportamiento real**, no opiniones. Siempre pedir:
   **«Cuéntame la última vez que ocurrió.»**
4. NO convertir opiniones en evidencia. Cada afirmación se registra con quote
   exacto + fecha + confianza.
5. NO racionalizar resultados negativos. Un "no" es información.
6. NO inventar entrevistas ni WTP. Este documento solo se actualiza con
   entrevistas ejecutadas reales.

## 3. Reclutamiento (12–15 entrevistas)

**Targets (roles):** VP People · Head of Talent · Head of L&D · Talent
Development leader · People Operations leader.

**Filtros ICP (prioridad):**
- 200–2.000 empleados.
- Sin Workday/SAP/HCM enterprise dominante.
- Fintech, healthtech, software, servicios profesionales.
- Alta contratación externa y/o esfuerzo visible de internal mobility/career
  development.
- Problemas conocidos de skills en spreadsheets o career conversations
  genéricas.

**Exclusiones:** solo amigos/founders/developers; personas sin autoridad sobre
L&D/Talent; empresas <100 o >5.000 empleados como entrevistas principales.

## 4. Guion de entrevista (comportamiento, no opiniones)

Flujo sugerido (~45 min):

1. **Workflow actual**
   - ¿Cómo gestionáis hoy el career development?
   - ¿Qué ocurre *después* de una conversación de desarrollo? ¿Quién documenta
     el plan? ¿Dónde vive?
   - ¿Dónde viven las skills (hoja de cálculo, HCM, nada)?
   - ¿Cómo sabéis si una persona está preparada para otro rol?
2. **Frecuencia y última vez**
   - ¿Cuándo fue la última vez que tuvisteis una conversación de desarrollo que
     no acabó en nada? ¿Qué pasó?
   - ¿Cuánto tiempo pasa entre identificar una necesidad y actuar?
3. **Consecuencia económica**
   - ¿Cuándo decidís contratar externamente en vez de mover internamente?
     ¿Cuánto costó la última vez? (coste de agencia, time-to-fill, vacante)
   - ¿Qué workaround utilizasteis? ¿Qué parte sigue siendo manual? ¿Qué
     información falta?
4. **Evidencia y autoridad**
   - ¿Quién tiene autoridad para actuar? ¿Qué evidencia necesita un manager?
     ¿Qué evidencia necesita People para mover a alguien?
   - ¿Qué os impide mover más talento internamente?
5. **Herramientas y presupuesto**
   - ¿Qué herramientas usáis hoy (incl. hojas de cálculo)? ¿Cuánto cuestan?
   - ¿Existe presupuesto para L&D/Talent/Mobility? ¿Quién lo controla?
   - ¿Aceptaríais evaluar un piloto real de 4–6 semanas? ¿Hablaríamos de
     presupuesto concreto?
6. **Riesgos**
   - ¿Qué te preocupa del uso de IA en recomendaciones de personas? ¿Privacidad
     de datos de desarrollo?

**Prohibido preguntar:** «¿te gusta la idea?», «¿lo comprarías?» sin contexto
de presupuesto, cualquier cosa que revele que estás vendiendo.

## 5. Scorecard (campos mínimos por entrevista)

Registrar UNA fila por entrevista real, con evidencia observable:

| # | company size | industry | buyer role | current workflow | current workaround | frequency | severity | economic consequence | existing budget | incumbent/tool | manual work | internal mobility behavior | external hiring consequence | evidence requirement | AI concern | privacy concern | willingness to pilot | willingness to pay | exact quote | confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

**Registro actual: 0 filas.** (No inventar filas.)

## 6. Thresholds del gate (§6)

| Señal | Umbral | Resultado actual |
|---|---|---|
| Problema recurrente y relevante | ≥ 8/15 | 0/15 (sin medir) |
| Workaround manual/fragmentado actual | ≥ 5/15 | 0/15 (sin medir) |
| Aceptan evaluar piloto real | ≥ 5/15 | 0/15 (sin medir) |
| WTP real o conversación de presupuesto | ≥ 3/15 | 0/15 (sin medir) |
| Design partners (piloto concierge 4–6 semanas) | ≥ 2 empresas | 0 (sin medir) |

**Si no se alcanzan: NO construir R5 completo → pivot analysis.**

## 7. Kill criteria (matar o reformular el wedge)

- El problema no aparece espontáneamente en la entrevista.
- Existe una solución suficientemente buena ya adoptada.
- El pain es «nice to have».
- El buyer no tiene presupuesto / el usuario no es el buyer.
- El manager no adopta el workflow.
- Internal mobility no es consecuencia real del problema.
- Evidence/auditability no tiene valor económico medible.
- El producto exige reemplazar el HCM o una integración enterprise masiva
  antes de aportar valor.
- WTP muy por debajo del coste de adquisición/soporte.

## 8. Panorama competitivo (investigación SECUNDARIA — no es validación)

Fuentes: `docs/R4_MARKET_VALIDATION.md` (E1–E10, comparativa hrtechsaas
jul-2026) + búsquedas de oct-2026. Lo desconocido se marca `UNKNOWN`; no se
afirma que un competidor «no pueda hacer X» sin evidencia.

| Vendor | ICP observado | Pricing | Impl. | Móvil. interna / career dev | Razón probable de rechazo en 200–2.000 empleados |
|---|---|---|---|---|---|
| Eightfold | Enterprise (10.000+), quote-only, 6 cifras | ~$7–10/emp/mes estimado (R4) | 4–12 semanas; impl. $5k–$50k (ITQlick vía pin.com, 2026) | Sí (talent intelligence sobre HCM) | Precio/Complejidad; requiere masa de datos/HCM; meses de despliegue |
| Gloat | Enterprise/mid-market alto, quote-only | UNKNOWN (no público) | Varía;.change management significativo | Sí (marketplace) | Cycles de ventas enterprise; adopción de manager resuelta «parcialmente» (R4: "none of them have solved it") |
| Fuel50 | Mid-market–enterprise, quote-only | UNKNOWN (no público) | Más rápido que Eightfold/Gloat (G2 vía hrtechsaas/Engagedly); ~6 meses según Docebo 2026 | Sí (career pathing + mobility) | 6 meses de impl.; alcance de plataforma > necesidad; pricing no público |
| Workday (HCM) | Enterprise | Bundle HCM | Pesado | Módulo, no foco | Reemplazar/contratar HCM completo = kill criterion de nuestro ICP |
| Degreed | Enterprise L&D | UNKNOWN | Mediano–alto | Career/skills ligado a learning | Foco L&D/learning, no conversación→movilidad con evidencia; pricing enterprise |
| Cornerstone | Enterprise | UNKNOWN | Alto (suite completa) | Sí (suite talent) | Suite completa; complejidad de implantación |
| Phenom | Mid-market 500+ / enterprise | $120k–$600k/año (costbench, jul-2026); quote-only | Significativo; change management | HM/talent mgmt | Precio de suite; complejidad; «difficult for mid-market to compare costs» (aitoolsatlas 2026) |
| Beamery | Enterprise, layered sobre Workday/SAP/Oracle | Quote-only, anual | Alto | Talent acquisition + workforce planning | Capa sobre HCM enterprise que nuestro ICP no tiene |

**Gap competitivo (hipótesis, sin validar con clientes):** los incumbentes
venden *plataformas de talento quote-only con impl. de semanas-a-meses*; no se
ha documentado ninguno cuyo flujo principal sea **conversación de desarrollo →
evidencia trazable → propuesta con confirmación humana → plan con next-action
medible** para empresas de 200–2.000 sin HCM. Confirmar o refutar en
entrevistas (preguntas 2 y 5 del guion).

## 9. Próximos pasos (en orden)

1. Reclutar 12–15 entrevistas ICP (usuario responsable del reclutamiento).
2. Ejecutar entrevistas → llenar scorecard §5 → medir thresholds §6.
3. PHASE C: PASS → wedge decision + ADR-014; FAIL → pivot matrix.
4. PHASE D: piloto concierge con 2 design partners (4–6 semanas), baseline y
   success criteria definidos ANTES de empezar.
5. PHASE E: productización (Career Profile → Gap determinista → Development
   Plan → next action) solo con señales fuertes.
