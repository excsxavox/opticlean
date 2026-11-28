import { seed } from '../../domain/seed.js';
import { emptyState } from '../../domain/tenant-state.js';
import { getCompany } from '../../domain/admin.service.js';
import { DEFAULT_COMPANY_ID } from '../../domain/request-context.js';
import type { AppState } from '../../domain/types.js';

/**
 * Estado con el que arranca una empresa: la empresa por defecto parte de los datos de
 * demostración (salvo OPTICLEAN_DEMO_DATA=0); las demás, vacías.
 */
export function initialStateFor(companyId: string): AppState {
  if (companyId === DEFAULT_COMPANY_ID && process.env.OPTICLEAN_DEMO_DATA !== '0') return seed();
  return emptyState(getCompany(companyId)?.name);
}
