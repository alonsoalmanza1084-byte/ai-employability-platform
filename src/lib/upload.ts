/**
 * Subida directa de archivos al storage privado de Convex.
 * El backend genera la URL firmada; el binario no pasa por nuestra API.
 */
export async function uploadToConvexStorage(
  uploadUrl: string,
  file: File,
): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    throw new Error("La subida del archivo falló. Intenta de nuevo.");
  }
  const json = (await res.json()) as { storageId: string };
  return json.storageId;
}

export const ACCEPTED_CV_TYPES = ".pdf,.docx,.txt";
export const MAX_CV_MB = 10;

export function validateCvFile(file: File): string | null {
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
    return "Formato no permitido. Usa PDF, DOCX o TXT.";
  }
  if (file.size > MAX_CV_MB * 1024 * 1024) {
    return `El archivo supera ${MAX_CV_MB} MB.`;
  }
  return null;
}
