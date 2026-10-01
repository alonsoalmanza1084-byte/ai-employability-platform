import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_CV_TYPES,
  MAX_CV_MB,
  uploadToConvexStorage,
  validateCvFile,
} from "@/lib/upload";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface ResumeVersion {
  _id: Id<"resumeVersions">;
  version: number;
  fileName: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  isActive: boolean;
  failureReason?: string;
  _creationTime: number;
}

interface Props {
  versions: ResumeVersion[];
  onVersionsChanged: () => void;
}

/**
 * Carga de CV con pipeline real:
 * initUpload (URL firmada) → POST binario → finalizeUpload → ingestCv.
 * Polling ligero del estado hasta ready/failed.
 */
export function CvUpload({ versions, onVersionsChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initUpload = useMutation(api.candidates.initUpload);
  const finalizeUpload = useMutation(api.candidates.finalizeUpload);
  const ingestCv = useAction(api.candidates.ingestCv);
  const setActiveVersion = useMutation(api.candidates.setActiveVersion);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<Id<"resumeVersions"> | null>(
    null,
  );

  // Derivado: la versión en proceso y su estado (sin setState en efectos).
  const processingVersion = processingId
    ? versions.find((x) => x._id === processingId)
    : undefined;
  const isProcessing =
    !!processingVersion &&
    (processingVersion.status === "processing" ||
      processingVersion.status === "uploaded");
  const processingFailed =
    !!processingVersion && processingVersion.status === "failed";

  // Polling ligero mientras la versión esté en curso (Convex refresca igual).
  useEffect(() => {
    if (!isProcessing) return;
    const t = setInterval(() => onVersionsChanged(), 2500);
    return () => clearInterval(t);
  }, [isProcessing, onVersionsChanged]);

  async function handleFile(file: File) {
    setError(null);
    const invalid = validateCvFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      const init = await initUpload({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });
      // Contrato v2 (auditoría #6): la denegación llega como ok:false, no como
      // excepción. Hay que comprobarlo explícitamente antes de usar uploadUrl.
      if (!init.ok) throw new Error(init.reason);
      const { uploadUrl } = init;
      const storageId = await uploadToConvexStorage(uploadUrl, file);
      const { resumeVersionId } = await finalizeUpload({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        storageId: storageId as Id<"_storage">,
      });
      setProcessingId(resumeVersionId);
      onVersionsChanged();
      // Dispara el pipeline (parser + IA) en background.
      void ingestCv({ resumeVersionId });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo subir el archivo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(id: Id<"resumeVersions">) {
    try {
      await setActiveVersion({ resumeVersionId: id });
      onVersionsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo activar.");
    }
  }

  return (
    <div className="hairline-t mt-10 pt-8">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_CV_TYPES}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium">Historial de CVs</p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, DOCX o TXT · máx {MAX_CV_MB} MB · análisis asistido por IA, todo
            editable después.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || isProcessing}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {busy ? "Subiendo…" : "Subir nueva versión"}
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {isProcessing && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4 animate-pulse" />
          Procesando tu CV con IA… puede tardar unos segundos.
        </div>
      )}

      {processingFailed && processingVersion?.failureReason && (
        <div className="mt-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {processingVersion.failureReason}
        </div>
      )}

      {versions.length > 0 && (
        <ul className="mt-6 divide-y divide-border rounded-md border border-border">
          {versions.map((v) => (
            <li
              key={v._id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    v{v.version} · {v.fileName}
                    {v.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · activa
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(v._creationTime).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {v.status === "ready" && <CheckCircle2 className="size-3.5" />}
                  {v.status === "processing" && (
                    <Clock className="size-3.5 animate-pulse" />
                  )}
                  {v.status === "failed" && (
                    <>
                      <AlertCircle className="size-3.5 text-destructive" />
                      <span className="max-w-48 truncate text-destructive">
                        {v.failureReason ?? "Error"}
                      </span>
                    </>
                  )}
                </span>
                {!v.isActive && v.status === "ready" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleActivate(v._id)}
                  >
                    <RefreshCw className="size-3.5" />
                    Activar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
