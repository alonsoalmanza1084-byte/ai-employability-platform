/**
 * Plantillas de requisitos de puesto (R6, ADR-014) — fuente única de verdad.
 *
 * Datos puros + helpers puros. Sin dependencias de Convex ni de servidor, para
 * que pueda usarse tanto en career.ts (server) como en Dashboard (cliente).
 *
 * El cliente usa esto para sugerir requisitos de referencia cuando el usuario
 * elije un objetivo profesional; el servidor usa el mismo conjunto para el
 * matching compatibleRoles. Un único conjunto => sin duplicación ni descalce.
 */

/** Versión de las plantillas (cambiar al modificar algún requisito). */
export const ROLE_REQUIREMENTS_VERSION = "roles-v1";

/** Requisito de puesto: skill + nivel requerido (1-5) + categoría opcional. */
export type RoleRequirement = {
  name: string;
  requiredLevel: number;
  category?: string;
};

/** Plantilla de puesto de referencia. */
export type RoleTemplate = {
  /** Identificador estable (no cambia aunque cambie el label). */
  id: string;
  /** Título del puesto (traducción humana; es la que el usuario lee). */
  label: string;
  /** Breve descripción de qué hace el puesto (sin promesas). */
  description: string;
  /** Requisitos deterministas del puesto. */
  skills: RoleRequirement[];
};

/**
 * Plantillas de referencia (conjunto inicial mínimo).
 *
 * Puestos comunes en la ruta de carreras de tecnología/producto que el sistema
 * puede expresar con skills + niveles sin taxonomía gigante.
 *
 * NO es un catálogo exhaustivo ni una promesa de cobertura del mercado.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "senior_frontend_developer",
    label: "Senior Frontend Developer",
    description:
      "Desarrolla interfaces complejas con React/TypeScript y mantiene calidad y testabilidad.",
    skills: [
      { name: "React", requiredLevel: 4 },
      { name: "TypeScript", requiredLevel: 4 },
      { name: "Testing", requiredLevel: 3 },
      { name: "Frontend Architecture", requiredLevel: 3 },
      { name: "Communication", requiredLevel: 3 },
    ],
  },
  {
    id: "frontend_tech_lead",
    label: "Frontend Tech Lead",
    description:
      "Lidera la calidad técnica del frontend, revisa diseños e impulsa decisiones de arquitectura.",
    skills: [
      { name: "React", requiredLevel: 4 },
      { name: "TypeScript", requiredLevel: 4 },
      { name: "Frontend Architecture", requiredLevel: 4 },
      { name: "Leadership", requiredLevel: 3 },
      { name: "Communication", requiredLevel: 4 },
    ],
  },
  {
    id: "product_engineer",
    label: "Product Engineer",
    description:
      "Conecta producto y tecnología: construye lo que aporta valor y mide el impacto.",
    skills: [
      { name: "React", requiredLevel: 3 },
      { name: "TypeScript", requiredLevel: 3 },
      { name: "Product Sense", requiredLevel: 3 },
      { name: "Communication", requiredLevel: 4 },
      { name: "Data Literacy", requiredLevel: 3 },
    ],
  },
  {
    id: "data_analyst",
    label: "Data Analyst",
    description:
      "Transforma datos en decisiones: consultas, dashboards y recomendaciones.",
    skills: [
      { name: "SQL", requiredLevel: 4 },
      { name: "Data Literacy", requiredLevel: 4 },
      { name: "Communication", requiredLevel: 3 },
      { name: "Visualization", requiredLevel: 3 },
      { name: "Statistics", requiredLevel: 3 },
    ],
  },
  {
    id: "engineering_manager",
    label: "Engineering Manager",
    description:
      "Lidera un equipo de ingeniería: entrega, desarrollo de personas y priorización.",
    skills: [
      { name: "Leadership", requiredLevel: 4 },
      { name: "Communication", requiredLevel: 4 },
      { name: "Delivery", requiredLevel: 4 },
      { name: "Hiring", requiredLevel: 3 },
      { name: "Architecture", requiredLevel: 3 },
    ],
  },
];

/** Lookup de plantilla por id estable. */
export function roleTemplateById(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((r) => r.id === id);
}

/**
 * Coincide un título ingresado por el usuario con una plantilla existente
 * (por similitud de label). Devuelve la plantilla o undefined si no hay
 * coincidencia suficiente: en ese caso el usuario define sus propios requisitos.
 */
export function findRoleTemplateByLabel(label: string): RoleTemplate | undefined {
  const key = label.trim().toLowerCase();
  for (const r of ROLE_TEMPLATES) {
    if (norm(r.label) === key || norm(r.id) === key) return r;
  }
  for (const r of ROLE_TEMPLATES) {
    const hay = norm(r.label);
    if (hay.includes(key) || key.includes(hay)) return r;
  }
  return undefined;
}

/** Convierte las skills de una plantilla a la forma del gap engine. */
export function roleSkillsAsRequired(
  template: RoleTemplate,
): Array<{ name: string; requiredLevel: number; category?: string }> {
  return template.skills.map((s) => ({
    name: s.name,
    requiredLevel: s.requiredLevel,
    category: s.category,
  }));
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
