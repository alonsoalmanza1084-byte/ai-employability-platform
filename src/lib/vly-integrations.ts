// Integraciones VLY — configuración de cliente.
//
// HALLAZGO DE SEGURIDAD (auditoría #4): este archivo era una copia de la
// plantilla que leía `process.env.VLY_INTEGRATION_KEY` desde el CÓDIGO DEL
// NAVEGADOR. Si se importaba, el token de despliegue acababa incrustado en el
// bundle público, que cualquiera puede descargar. No lo importaba nadie, pero
// era una puerta abierta a la exfiltración de la credencial.
//
// Regla inviolable: NINGÚN secreto de servidor se lee desde el cliente.
// Las integraciones que requieran el token deben exponerse por una action
// "use node" de Convex (ver src/convex/lib/ai/vly_provider.ts), nunca desde el
// frontend. Este módulo se mantiene solo como guardia que falla cerrado.

/**
 * @deprecated No usar desde el cliente. Lanza siempre.
 * @throws Error siempre — por diseño, para que nadie lo use por accidente.
 */
export function createVlyIntegrations(): never {
  throw new Error(
    "Las integraciones VLY no se pueden inicializar desde el cliente: el token de despliegue nunca debe salir del servidor. Usa una action 'use node' de Convex.",
  );
}