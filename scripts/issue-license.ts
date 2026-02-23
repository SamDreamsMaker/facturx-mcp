#!/usr/bin/env tsx
/**
 * Outil d'émission de licences Factur-X MCP
 * Usage (depuis la racine du projet) :
 *
 *   source .env.issuer && npx tsx scripts/issue-license.ts \
 *     --email=client@example.com \
 *     --plan=pro \
 *     --days=365
 *
 * Variables d'environnement requises (dans .env.issuer) :
 *   LICENSE_PRIVATE_KEY  — clé privée ECDSA P-256 au format PEM
 */
import crypto from 'crypto';
import { randomUUID } from 'crypto';

// ── Parsing des arguments CLI ─────────────────────────────────────────────────
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
}

const email   = getArg('email');
const plan    = (getArg('plan') ?? 'pro') as 'pro' | 'enterprise';
const days    = parseInt(getArg('days') ?? '365', 10);

if (!email) {
  console.error('❌ Usage : tsx scripts/issue-license.ts --email=x@x.com --plan=pro --days=365');
  process.exit(1);
}

if (!['pro', 'enterprise'].includes(plan)) {
  console.error('❌ Plan invalide. Valeurs : pro, enterprise');
  process.exit(1);
}

// ── Clé privée depuis l'environnement ─────────────────────────────────────────
const privateKeyPem = process.env.LICENSE_PRIVATE_KEY;
if (!privateKeyPem) {
  console.error('❌ Variable LICENSE_PRIVATE_KEY manquante.');
  console.error('   Lancez : source .env.issuer && npx tsx scripts/issue-license.ts ...');
  process.exit(1);
}

// ── Construction du payload ───────────────────────────────────────────────────
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const issuedAt  = toYMD(new Date());
const expiresAt = toYMD(new Date(Date.now() + days * 86_400_000));

const payload = {
  id:        randomUUID(),
  email,
  plan,
  issuedAt,
  expiresAt,
};

// ── Signature ECDSA P-256 ─────────────────────────────────────────────────────
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

let licenseKey: string;
try {
  const privateKey  = crypto.createPrivateKey(privateKeyPem);
  const signature   = crypto.sign('SHA256', Buffer.from(payloadB64, 'utf-8'), privateKey);
  const signatureB64 = signature.toString('base64url');
  licenseKey = `FTRX-${payloadB64}.${signatureB64}`;
} catch (e) {
  console.error('❌ Erreur lors de la signature :', e);
  process.exit(1);
}

// ── Sortie ────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  LICENCE FACTURX-MCP GÉNÉRÉE');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Client   : ${email}`);
console.log(`  Plan     : ${plan.toUpperCase()}`);
console.log(`  Émise le : ${issuedAt}`);
console.log(`  Expire   : ${expiresAt}  (${days} jours)`);
console.log(`  ID       : ${payload.id}`);
console.log('───────────────────────────────────────────────────────────');
console.log('  CLÉ DE LICENCE (à envoyer au client) :');
console.log('');
console.log(`  ${licenseKey}`);
console.log('');
console.log('  Configuration MCP client :');
console.log('  "env": {');
console.log(`    "FACTURX_LICENSE_KEY": "${licenseKey}"`);
console.log('  }');
console.log('═══════════════════════════════════════════════════════════\n');
