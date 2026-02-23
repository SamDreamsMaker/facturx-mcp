/**
 * Système de licence Factur-X MCP
 * Validation cryptographique ECDSA P-256 — fonctionne 100% offline
 * La clé privée reste chez le vendeur, seule la clé publique est embarquée ici.
 */
import crypto from 'crypto';

// ── Clé publique embarquée (impossible de forger une licence sans la clé privée) ──
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEW4KwdEErBdEtpAphOQnWJz/XQO7o
Eu6cVfvMOb8ecHCqZ9aqz3EXxiPnOtsxn4/xPIb+lmKlY9DSfQXPL9c6Sw==
-----END PUBLIC KEY-----`;

export type Plan = 'free' | 'pro' | 'enterprise';

export interface LicensePayload {
  id: string;          // Identifiant unique licence
  email: string;       // Email du client
  plan: Plan;
  issuedAt: string;    // YYYY-MM-DD
  expiresAt: string;   // YYYY-MM-DD
}

export interface LicenseResult {
  valid: boolean;
  plan: Plan;
  email?: string;
  licenseId?: string;
  expiresAt?: Date;
  daysLeft?: number;
  error?: string;
}

// ── Outils nécessitant une licence Pro ────────────────────────────────────────
export const PRO_TOOLS = new Set([
  'facturx_create_pdf',
  'facturx_extract_from_pdf',
  'chorus_submit',
  'chorus_get_status',
  'chorus_list_invoices',
]);

// ── Cache en mémoire (évite de re-valider à chaque appel d'outil) ─────────────
let cachedResult: LicenseResult | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 heure

export function validateLicenseKey(rawKey: string): LicenseResult {
  // Vérifier le cache
  if (cachedResult && Date.now() < cacheExpiry) return cachedResult;

  const result = _validate(rawKey.trim());

  // Mettre en cache (même les résultats négatifs pour éviter le spam)
  cachedResult = result;
  cacheExpiry = Date.now() + (result.valid ? CACHE_TTL_MS : 5 * 60 * 1000);

  return result;
}

export function clearLicenseCache(): void {
  cachedResult = null;
  cacheExpiry = 0;
}

function _validate(key: string): LicenseResult {
  // Format attendu : FTRX-{base64url_payload}.{base64url_signature}
  if (!key.startsWith('FTRX-')) {
    return { valid: false, plan: 'free', error: 'Format de clé invalide (doit commencer par FTRX-)' };
  }

  const body = key.slice(5); // Retirer "FTRX-"
  const dotIndex = body.lastIndexOf('.');
  if (dotIndex === -1) {
    return { valid: false, plan: 'free', error: 'Format de clé invalide (séparateur manquant)' };
  }

  const payloadB64   = body.slice(0, dotIndex);
  const signatureB64 = body.slice(dotIndex + 1);

  if (!payloadB64 || !signatureB64) {
    return { valid: false, plan: 'free', error: 'Clé de licence corrompue' };
  }

  // ── Vérification cryptographique ECDSA P-256 ──────────────────────────────
  try {
    const publicKey  = crypto.createPublicKey(PUBLIC_KEY_PEM);
    const dataBuffer = Buffer.from(payloadB64, 'utf-8');
    const sigBuffer  = Buffer.from(signatureB64, 'base64url');

    const isValid = crypto.verify('SHA256', dataBuffer, publicKey, sigBuffer);
    if (!isValid) {
      return { valid: false, plan: 'free', error: 'Signature de licence invalide — clé refusée' };
    }
  } catch {
    return { valid: false, plan: 'free', error: 'Erreur lors de la vérification cryptographique' };
  }

  // ── Décodage du payload ───────────────────────────────────────────────────
  let payload: LicensePayload;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    payload = JSON.parse(json) as LicensePayload;
  } catch {
    return { valid: false, plan: 'free', error: 'Payload de licence illisible' };
  }

  // ── Vérification de l'expiration ──────────────────────────────────────────
  const expiresAt  = new Date(payload.expiresAt);
  const now        = new Date();
  const daysLeft   = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);

  if (expiresAt < now) {
    return {
      valid: false,
      plan: 'free',
      email: payload.email,
      licenseId: payload.id,
      expiresAt,
      daysLeft: 0,
      error: `Licence expirée le ${payload.expiresAt} — renouvelez sur polar.sh`,
    };
  }

  return {
    valid: true,
    plan: payload.plan,
    email: payload.email,
    licenseId: payload.id,
    expiresAt,
    daysLeft,
  };
}

/**
 * Retourne un message d'erreur formaté lorsqu'un outil Pro est demandé sans licence.
 */
export function buildUpgradeMessage(toolName: string, license: LicenseResult): string {
  const lines = [
    `🔒 L'outil "${toolName}" nécessite une licence Pro.`,
    ``,
    `Plan actuel : ${license.plan === 'free' ? 'Gratuit (limité)' : license.plan}`,
  ];

  if (license.error) lines.push(`Raison : ${license.error}`);

  lines.push(
    ``,
    `Pour activer toutes les fonctionnalités :`,
    `  → https://buy.polar.sh/polar_cl_hhTVyZpvFsZ2jlddR0OZz0ZP4KG9FuebS5OYp0mKRNR`,
    ``,
    `Après achat, ajoutez la clé dans votre configuration MCP :`,
    `  "env": { "FACTURX_LICENSE_KEY": "FTRX-..." }`,
  );

  return lines.join('\n');
}
