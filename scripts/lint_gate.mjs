/**
 * CI gate — atribución de errores de lint por archivo.
 *
 * Tolerancia EXPLÍCITA ylimitados a de 3 archivos de plantilla (shadcn/ui y un hook)
 * cuyos errores son preexistentes del scaffold y ajenos al producto. Cualquier
 * error en código propio (src fuera de ui/, tests/, scripts/) rompe el gate.
 *
 * Salida: una línea "TEMPLATE=<n> OWN=<n> FILES=<lista>" y código de salida
 * 0 si OWN == 0 y TEMPLATE > 0; 1 en caso contrario.
 */
import { execFileSync } from "node:child_process";

const TEMPLATE_FILES = [
  "src/components/ui/carousel.tsx",
  "src/components/ui/sidebar.tsx",
  "src/hooks/use-mobile.ts",
];

let raw = "";
try {
  raw = execFileSync("bunx", ["eslint", ".", "-f", "json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  // eslint sale con código != 0 cuando hay errores, pero la salida JSON sigue
  // siendo válida: se usa la salida del error.
  raw = (e && e.stdout) || "";
}

let report = [];
try {
  report = JSON.parse(raw || "[]");
} catch {
  console.log("TEMPLATE=0 OWN=-1 FILES=no-se-pudo-analizar-la-salida-de-eslint");
  process.exit(1);
}

let template = 0;
const ownFiles = [];
for (const f of report) {
  const errors = (f.messages || []).filter((m) => m.severity === 2);
  if (!errors.length) continue;
  const rel = f.filePath.replace(process.cwd() + "/", "");
  if (TEMPLATE_FILES.includes(rel)) {
    template += errors.length;
  } else {
    ownFiles.push(`${rel} (${errors.length})`);
  }
}

console.log(`TEMPLATE=${template} OWN=${ownFiles.length} FILES=${ownFiles.join(", ") || "-"}`);
if (ownFiles.length > 0 || template === 0) process.exit(1);
process.exit(0);