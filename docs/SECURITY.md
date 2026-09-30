# SECURITY.md — Arquitectura de seguridad V1

Principio rector: **"ligeramente más complejo pero seguro"** siempre gana. Cada endpoint valida identidad, organización, rol, permisos y ownership — server-side, siempre.

## 1. Modelo de capas (defensa en profundidad)

```
Capa 1  Transporte:        HTTPS forzado, cookies httpOnly/secure/sameSite (Convex Auth)
Capa 2  Autenticación:     email OTP de 6 dígitos con expiración 15 min; sesiones server-side
Capa 3  Autorización:      RBAC + ownership + tenant check en cada query/mutation/action
Capa 4  Datos:             storage privado (sin buckets públicos); IDs opacos; lecturas siempre por índice con tenant prefijo
Capa 5  Archivos:          magic bytes + MIME + tamaño + parser en sandbox de texto (nunca se ejecuta el archivo)
Capa 6  IA:                datos≠instrucciones, salida validada por schema, sin tools arbitrarias (ver AI_SECURITY.md)
Capa 7  Observabilidad:    auditLog + securityEvents + rate limits configurables
```

## 2. Autenticación (V1)

- **Email OTP:** 6 dígitos, expira 15 min, un solo uso (lo maneja Convex Auth). Ventaja de seguridad: no hay contraseñas → no hay credential stuffing ni password reuse contra nuestro servicio; el canal de email es el factor.
- **Guest anónimo:** sesión anónima aislada; ve solo su propio espacio; al registrarse puede conservar datos.
- **Sesiones:** cookie httpOnly server-side (Convex Auth). Sin tokens JWT en localStorage.
- **Rate limit de OTP:** límite de emisión por email+IP (ver Threat Model § brute force: el OTP de 6 dígitos tiene ventana corta + límites de intento del provider).
- **Roadmap autenticación** (post-V1, documentado en DECISIONS.md): verificación de email explícita, recuperación de contraseña (cuando haya passwords), OAuth, MFA para org_admin/platform_admin, detección de sesión sospechosa, logout global y revocación. Convex Auth soporta revocación de sesiones (tabla authSessions).

## 3. Autorización (resumen; detalle en RBAC.md)

Cada función ejecuta, en orden:
1. `getAuthUserId` → si null → `UNAUTHENTICATED`.
2. Ownership/tenancy: ¿el recurso pertenece al usuario o a una org de la que es miembro activo? Query por índice con `userId`/`organizationId` real (jamás aceptado del cliente sin verificar).
3. Rol mínimo requerido para la operación.
4. Si cualquiera falla → `NOT_FOUND` o `FORBIDDEN` genérico (no filtramos existencia).

## 4. Multi-tenancy (resumen; detalle en MULTI_TENANCY.md)

- Todo dato de org lleva `organizationId`; toda lectura de datos de org usa índice con prefijo `organizationId` obtenido desde la membresía del actor, **nunca** del payload del cliente.
- Las mutaciones de escritura re-verifican el tenant del recurso destino en la misma transacción que la escritura.
- Storage: los archivos se sirven con URLs firmadas de vida corta generadas server-side, solo tras verificar permiso sobre el documento que los referencia.

## 5. Archivos (CVs)

| Control | Implementación |
|---|---|
| Tamaño | ≤ 10 MB, chequeado antes y después de subir |
| Extensiones permitidas | pdf, docx, txt |
| MIME real | magic bytes: `%PDF`, `PK\x03\x04` (docx/zip), texto UTF-8/latin para txt |
| Contenido | parser solo extrae texto; **nunca** se ejecuta, renderiza ni abre el archivo |
| PDFs maliciosos | el parser (pdf-parse) no ejecuta JS/embebidos; solo leemos streams de texto; además limitamos extracción a N caracteres |
| DOCX (zip) | mammoth extrae texto; no se descomprime nada arbitrario ni se acceden partes fuera de document.xml |
| Almacenamiento | Convex fileStorage privado; URLs firmadas de corta vida solo al dueño o recruiter autorizado |
| Retención | binario + texto viven mientras exista la versión; al eliminar cuenta → borrado (ver PRIVACY.md) |

## 6. IA (resumen; detalle en AI_SECURITY.md)

- Texto de CV/vacante se inyecta como **dato delimitado**, no como instrucciones; el system prompt declara que el contenido puede intentar manipulación y debe ignorarla.
- Salida SIEMPRE validada con zod contra schema estricto; si falla → reintento controlado → estado `failed` visible, nunca datos corruptos en BD.
- El LLM no tiene tools, ni acceso a BD, ni secrets. Los efectos sobre datos los ejecuta nuestro código determinista después de validar.

## 7. Secrets y configuración

- Secrets solo server-side en env vars de Convex (`OPENAI_API_KEY`, etc.). Nunca en el bundle del cliente; `import.meta.env.VITE_*` reservado a valores públicos (URL de Convex).
- El cliente nunca recibe la API key; las llamadas IA ocurren en actions `"use node"`.
- Rotación documentada en RUNBOOK.md.

## 8. Dependencias y supply chain

- Dependencias mínimas; lockfile versionado; revisión en PR para nuevas deps.
- `bun audit` / `npm audit` en pipeline; sin `postinstall` scripts de terceros no auditados.
- Parsers (pdf-parse, mammoth) usados solo en el servidor, nunca en el browser.

## 9. Headers y CSRF

- La SPA habla con Convex por WebSocket/HTTPS con cookies sameSite (protección CSRF de facto para mutaciones autenticadas por cookie; Convex Auth maneja tokens de sesión en cookie httpOnly).
- No hay iframes de terceros con datos; no hay webhooks entrantes en V1 (los de billing llegarán con verificación de firma + timestamp + replay window, ver BILLING.md).

## 10. Checklist "production-ready" (no declarar hasta cumplir)

- [ ] Todos los endpoints con auth+tenant+RBAC verificados por tests automatizados
- [ ] Tests de aislamiento cross-tenant pasando (candidato A no ve nada de B; org 1 no ve nada de org 2)
- [ ] Rate limits activos y testeado el 429
- [ ] Validación de archivos (magic bytes, tamaño) testeada con archivos hostiles
- [ ] Prompt injection suite corriendo sin filtraciones
- [ ] auditLog escribiendo en todas las acciones sensibles
- [ ] Secrets solo server-side; auditoría de bundle sin fugas
- [ ] Backups + restore ensayado; RPO/RTO definidos (DISASTER_RECOVERY.md)
- [ ] Observabilidad mínima: logs estructurados, métricas de uso, alerta de errores IA
- [ ] Revisión legal de textos de privacidad/TOS (nota, no bloqueante para staging)
