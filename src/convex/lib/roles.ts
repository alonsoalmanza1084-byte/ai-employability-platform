/**
 * Re-export del conjunto de plantillas de puesto (fuente única en src/lib/roles).
 *
 * career.ts lo importa vía ./lib/roles y termina en src/lib/roles; el cliente
 * lo importa vía @/lib/roles. Un único conjunto de datos.
 */
export { ROLE_REQUIREMENTS_VERSION, ROLE_TEMPLATES, roleTemplateById, findRoleTemplateByLabel, roleSkillsAsRequired, type RoleRequirement, type RoleTemplate } from "../../lib/roles";
