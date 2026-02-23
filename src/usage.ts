/**
 * Suivi des quotas pour le tier gratuit.
 * Stocke un compteur journalier dans ~/.facturx-mcp/usage.json
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const USAGE_DIR  = join(homedir(), '.facturx-mcp');
const USAGE_FILE = join(USAGE_DIR, 'usage.json');

export const FREE_DAILY_LIMIT = 10; // générations/jour en tier gratuit

interface UsageData {
  date:  string; // YYYY-MM-DD
  count: number;
}

async function readUsage(): Promise<UsageData> {
  try {
    const raw = await readFile(USAGE_FILE, 'utf-8');
    return JSON.parse(raw) as UsageData;
  } catch {
    return { date: '', count: 0 };
  }
}

async function writeUsage(data: UsageData): Promise<void> {
  await mkdir(USAGE_DIR, { recursive: true });
  await writeFile(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Vérifie si le tier gratuit peut encore générer aujourd'hui.
 * Retourne { allowed: true } ou { allowed: false, used, limit }
 */
export async function checkFreeQuota(): Promise<
  { allowed: true; used: number; remaining: number } |
  { allowed: false; used: number; limit: number }
> {
  const data = await readUsage();
  const todayStr = today();

  // Nouveau jour → remise à zéro
  const used = data.date === todayStr ? data.count : 0;

  if (used >= FREE_DAILY_LIMIT) {
    return { allowed: false, used, limit: FREE_DAILY_LIMIT };
  }
  return { allowed: true, used, remaining: FREE_DAILY_LIMIT - used };
}

/**
 * Incrémente le compteur après une génération réussie.
 */
export async function incrementFreeUsage(): Promise<void> {
  const data  = await readUsage();
  const todayStr = today();

  const count = data.date === todayStr ? data.count + 1 : 1;
  await writeUsage({ date: todayStr, count });
}

/**
 * Retourne le message affiché quand le quota journalier est atteint.
 */
export function buildQuotaMessage(used: number, limit: number): string {
  return [
    `⏱ Quota journalier atteint (${used}/${limit} générations utilisées aujourd'hui).`,
    ``,
    `Le tier gratuit permet ${limit} générations Factur-X par jour.`,
    `Pour un usage illimité, passez en Pro :`,
    `  → https://buy.polar.sh/polar_cl_hhTVyZpvFsZ2jlddR0OZz0ZP4KG9FuebS5OYp0mKRNR`,
    ``,
    `Votre quota se renouvelle automatiquement à minuit.`,
  ].join('\n');
}
