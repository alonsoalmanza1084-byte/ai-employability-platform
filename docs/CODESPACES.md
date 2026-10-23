# Desarrollo en GitHub Codespaces

## Arranque

1. Abre dos terminales en el Codespace.
2. En la primera, inicia el deployment de desarrollo de Convex con
   `npx convex dev` y completa la autenticación/configuración si se solicita.
   Comprueba que `VITE_CONVEX_URL` apunta al mismo deployment de desarrollo.
3. En la segunda, ejecuta `npm run dev`.
4. En la pestaña **Ports**, configura el puerto `5173` como **Public** y abre
   la URL reenviada HTTPS de ese puerto. El servidor Vite escucha en todas las
   interfaces y el cliente HMR se conecta por el puerto HTTPS `443`.

Mantén ambos procesos activos mientras pruebas. Si cambias la configuración de
Vite, reinicia `npm run dev`.

## Verificación de subida de CV

Desde la URL pública de Codespaces, inicia sesión (también está disponible el
proveedor Anonymous de Convex Auth), abre la carga de CV y sube un PDF, DOCX o
TXT válido de hasta 10 MiB. La petición del binario va desde el navegador a la
URL firmada de storage de Convex, no a través de Vite. La interfaz debe pasar a
`uploaded`/`processing` y finalmente mostrar el resultado o un error de análisis
controlado. La validación server-side rechaza otros formatos y archivos mayores
de 10 MiB; el parser comprueba el contenido real del archivo.

## Si aparece 502

- Si el 502 corresponde a la URL pública del frontend, verifica que Vite siga
  ejecutándose en el puerto `5173`, que `npm run dev` use `--host 0.0.0.0` y
  que el puerto `5173` esté marcado **Public** en **Ports**. Reinicia Vite si
  acabas de cambiar la configuración.
- Si la página carga pero falla la subida, identifica en la pestaña **Network**
  qué petición devuelve el error. La petición del archivo debe dirigirse a
  `convex.cloud` (o al endpoint de storage del deployment configurado), no a
  `localhost` ni a la URL del puerto 5173. Comprueba que `VITE_CONVEX_URL` y
  `CONVEX_DEPLOYMENT` correspondan al mismo deployment de desarrollo.
  Asegúrate de que `npx convex dev` siga activo.
- Un 502 del frontend suele indicar que el proxy no alcanza Vite; un error en
  el endpoint de Convex debe diagnosticarse en Convex y no se corrige cambiando
  el proxy de Vite.
