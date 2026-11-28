import { JsonStateRepository } from '../persistence/JsonStateRepository.js';
import { PostgresStateRepository } from '../persistence/PostgresStateRepository.js';
import { prepareAuth, setCompanyActiveCheck } from '../auth/auth.js';
import { getCompany } from '../../domain/admin.service.js';
import { getAdminDb } from '../db/adminDb.js';
import { scheduleAuthBackups } from '../persistence/auth-backup.js';
import { isProd, loadEnvFile, resetAllowed } from './env.js';
import { createApp } from './app.js';

loadEnvFile();
// En producción no arranca sin secreto propio ni con usuarios demo.
prepareAuth();

// Usuarios de una empresa desactivada no pueden entrar ni usar sesiones abiertas.
setCompanyActiveCheck((companyId) => {
  const company = getCompany(companyId);
  return !company || company.active === 1;
});

// Con DATABASE_URL el estado vive en PostgreSQL; sin ella, en archivos JSON por empresa.
const repo = process.env.DATABASE_URL?.trim() ? new PostgresStateRepository() : new JsonStateRepository();
console.log(`[state] Almacén: ${repo instanceof PostgresStateRepository ? 'PostgreSQL' : 'archivos JSON'}`);
const app = createApp(repo);

// Inicializa SQLite (menú / módulos / empresas)
getAdminDb();
// Respaldo diario de usuarios y de la base de empresas, junto a los del estado.
scheduleAuthBackups(repo.backupsDir);
if (isProd() && !resetAllowed()) console.log('[state] Reinicio de datos desactivado (producción).');

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`OPTICLEAN API en http://localhost:${PORT}`);
});
