# TalentFlow AI

Plataforma de empleabilidad y recruiting asistida por IA, de dos lados:

- **Candidatos:** suben su CV (PDF/DOCX/TXT), la IA lo estructura y produce un **diagnóstico de empleabilidad** con oportunidades de mejora accionables. Pantalla principal: **Mi CV y diagnóstico**.
- **Empresas/RH:** crean organizaciones y vacantes con requisitos ponderados, suben CVs y obtienen **match scores explicables con evidencia** por requisito. La decisión (preselección/rechazo) es **siempre humana** y queda auditada.

## Stack

- Frontend: React 19 + Vite + Tailwind v4 + shadcn/ui (tema minimalista, casi monocromo)
- Backend: Convex (queries/mutations/actions), multi-tenant por `organizationId`
- Auth: Convex Auth (email OTP + guest)
- IA: capa de abstracción `AIProvider` → OpenAI (JSON mode, salida validada con zod)
- Parsing de CVs: pdf-parse / mammoth en actions `"use node"`
- Matching: motor **determinista** auditable (sin LLM en el scoring)

## Configuración requerida

- `OPENAI_API_KEY`: clave de OpenAI (configúrala en las variables de entorno del proyecto). Sin ella, el análisis de CVs fallará con un mensaje claro y reintentable.
- Opcionales: `AI_MODEL` (default `gpt-4o-mini`), `AI_PROVIDER` (default `openai`).

## Documentación

Ver [`/docs`](./docs/README.md): PRD, arquitectura, base de datos, API, seguridad, threat model, AI security, privacidad, RBAC, multi-tenancy, billing, observabilidad, DR, testing, despliegue, runbook y ADRs.

## Reglas del producto

1. La IA nunca decide sobre personas — el matching es una recomendación con evidencia; la decisión final es humana y registrada.
2. Sin promesas de resultados (no hay garantías de aumentos salariales ni de éxito).
3. Datos de candidatos: privado por diseño, aislamiento estricto entre organizaciones, sin entrenamiento de modelos.
