# DISASTER_RECOVERY.md — Continuidad V1

## 1. Backups

- **Base de datos:** Convex maneja réplicas y snapshots del servicio. Adicionalmente, snapshot exportable desde dashboard Convex (procedimiento mensual en V1).
- **Archivos (CVs):** viven en Convex storage; el binario se puede re-descargar desde la app si existe la fila. Backup = snapshot de BD + storage del proveedor.
- **Cifrado:** en tránsito TLS; en reposo según proveedor (at-rest encryption estándar de la plataforma).
- **Retención:** snapshots mensuales × 12 en V1.

## 2. RPO / RTO objetivos

| Escenario | RPO | RTO |
|---|---|---|
| Pérdida de BD | ≤ 24 h (snapshot mensual en V1; semanal cuando haya billing) | ≤ 8 h |
| Pérdida de storage | ≤ 24 h | ≤ 8 h |
| Caída del proveedor IA | 0 (no hay pérdida; degradación) | minutos (fallback/cambia proveedor por env) |
| Caída del proveedor de email | 0 (no hay pérdida; no se puede hacer login OTP) | hasta recuperación del proveedor (comunicar por status page) |

## 3. Procedimientos si…

- **Database dies:** restaurar snapshot más reciente en nueva deployment; validar schema + datos canary (un usuario de prueba); comunicar a usuarios.
- **Storage dies:** los metadatos en BD permiten saber qué falta; re-subida solicitada a usuarios para archivos perdidos (peor caso), o restore del snapshot del proveedor.
- **AI provider down:** ingest queda en estado `processing` con reintento del scheduler; si es prolongado, cambiar `AI_PROVIDER`/`AI_MODEL` a proveedor alternativo (la abstracción lo permite sin deploy de código, solo env).
- **Payment provider down** (futuro): la app sigue operando; cobros se reintentan; webhooks perdidos se re-sincronizan con el proveedor.
- **Email provider down:** login OTP afectado → mostrar aviso en la pantalla de auth; rate limits siguen; probar proveedor alterno (fase posterior).

## 4. Pruebas

- Restore drill trimestral: restaurar snapshot en entorno staging y validar lectura/escritura + integridad de perfiles y CVs.
- Failover drill de proveedor IA: simular error y validar reintentos y estado `failed` accionable.
