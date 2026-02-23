/**
 * Webhook Polar.sh → génération automatique de licence Facturx MCP
 * Déployer sur Vercel (gratuit) : vercel --prod
 *
 * Variables d'environnement requises dans Vercel :
 *   LICENSE_PRIVATE_KEY    — clé privée ECDSA P-256 PEM (même que .env.issuer)
 *   POLAR_WEBHOOK_SECRET   — secret webhook Polar.sh (Settings → Webhooks)
 *   RESEND_API_KEY         — clé API Resend (resend.com, gratuit 3000/mois)
 *   FROM_EMAIL             — expéditeur vérifié (ex: noreply@votre-domaine.com)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto, { randomUUID } from 'crypto';

// ── Désactiver le body parser Vercel pour accéder au body brut (requis pour HMAC) ──
export const config = { api: { bodyParser: false } };

// ── Lecture du body brut ───────────────────────────────────────────────────────
function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8'); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── Vérification signature Polar.sh (Standard Webhooks — HMAC-SHA256) ─────────
function verifyPolarSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const msgId        = headers['webhook-id'] as string;
  const msgTimestamp = headers['webhook-timestamp'] as string;
  const msgSignature = headers['webhook-signature'] as string;

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Protection replay : rejeter les messages de plus de 5 minutes
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign   = `${msgId}.${msgTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(toSign)
    .digest('base64');

  return msgSignature.split(' ').some((sig) => {
    const value = sig.startsWith('v1,') ? sig.slice(3) : sig;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(value,    'base64'),
        Buffer.from(expected, 'base64'),
      );
    } catch {
      return false;
    }
  });
}

// ── Génération de la clé FTRX- (même logique que scripts/issue-license.ts) ────
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generateLicenseKey(email: string, plan: 'pro' | 'enterprise'): string {
  const rawPem = process.env.LICENSE_PRIVATE_KEY ?? '';
  // Vercel stocke les sauts de ligne comme \n littéraux dans les env vars
  const privateKeyPem = rawPem.replace(/\\n/g, '\n');

  const issuedAt  = toYMD(new Date());
  const expiresAt = toYMD(new Date(Date.now() + 35 * 86_400_000)); // 35 jours (grace period)

  const payload = { id: randomUUID(), email, plan, issuedAt, expiresAt };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const privateKey  = crypto.createPrivateKey(privateKeyPem);
  const signature   = crypto.sign('SHA256', Buffer.from(payloadB64, 'utf-8'), privateKey);
  return `FTRX-${payloadB64}.${signature.toString('base64url')}`;
}

// ── Template email de livraison ────────────────────────────────────────────────
function emailHtml(licenseKey: string, plan: string): string {
  const planLabel = plan === 'enterprise' ? 'Enterprise' : 'Pro';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h2 style="color: #0f172a;">🔑 Votre licence Facturx MCP ${planLabel} est prête</h2>
  <p>Merci pour votre abonnement ! Voici votre clé de licence :</p>

  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; word-break: break-all;">
    <code style="font-size: 13px; color: #0f766e;">${licenseKey}</code>
  </div>

  <h3>Activation en 2 étapes</h3>
  <p><strong>1. Ouvrez votre fichier de configuration Claude Desktop :</strong></p>
  <ul>
    <li>Windows : <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></li>
    <li>macOS : <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
  </ul>

  <p><strong>2. Ajoutez (ou mettez à jour) la section mcpServers :</strong></p>
  <pre style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; font-size: 13px; overflow-x: auto;">{
  "mcpServers": {
    "facturx": {
      "command": "facturx-mcp",
      "env": {
        "FACTURX_LICENSE_KEY": "${licenseKey}"
      }
    }
  }
}</pre>

  <p>3. Redémarrez Claude Desktop — votre plan ${planLabel} est actif.</p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #64748b; font-size: 13px;">
    Cette licence est valable 35 jours. Vous recevrez automatiquement une nouvelle clé lors du renouvellement mensuel.<br>
    Questions ? Répondez directement à cet email.
  </p>
  <p style="color: #64748b; font-size: 13px;">
    <a href="https://www.npmjs.com/package/facturx-mcp">Facturx MCP sur npm</a>
  </p>
</body>
</html>`.trim();
}

// ── Envoi via Resend ───────────────────────────────────────────────────────────
async function sendLicenseEmail(to: string, licenseKey: string, plan: string): Promise<void> {
  const apiKey   = process.env.RESEND_API_KEY ?? '';
  const from     = process.env.FROM_EMAIL ?? 'onboarding@resend.dev';
  const planLabel = plan === 'enterprise' ? 'Enterprise' : 'Pro';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `🔑 Votre licence Facturx MCP ${planLabel} — activez-la maintenant`,
      html: emailHtml(licenseKey, plan),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const rawBody = await readRawBody(req);
  const secret  = process.env.POLAR_WEBHOOK_SECRET ?? '';

  if (!verifyPolarSignature(rawBody, req.headers as Record<string, string>, secret)) {
    console.error('❌ Signature webhook invalide');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('📨 Polar event:', event.type);

  // Événements déclenchant une livraison de licence
  const TRIGGER_EVENTS = ['order.created', 'subscription.created', 'subscription.active'];
  if (!TRIGGER_EVENTS.includes(event.type)) {
    return res.status(200).json({ received: true, skipped: true });
  }

  const data = event.data as Record<string, unknown>;

  // Extraire l'email (structure Polar.sh)
  const customer = data.customer as Record<string, unknown> | undefined;
  const email     = (customer?.email ?? data.email) as string | undefined;

  if (!email) {
    console.error('❌ Pas d\'email dans l\'événement:', JSON.stringify(data, null, 2));
    return res.status(400).json({ error: 'Missing customer email' });
  }

  // Déterminer le plan selon le montant (en centimes)
  const productPrice = data.product_price as Record<string, unknown> | undefined;
  const amount = (data.amount ?? productPrice?.price_amount ?? 999) as number;
  const plan: 'pro' | 'enterprise' = amount >= 4000 ? 'enterprise' : 'pro';

  try {
    const licenseKey = generateLicenseKey(email, plan);
    await sendLicenseEmail(email, licenseKey, plan);
    console.log(`✅ Licence ${plan} envoyée à ${email}`);
    return res.status(200).json({ success: true, plan, email });
  } catch (err) {
    console.error('❌ Erreur traitement commande:', err);
    return res.status(500).json({ error: String(err) });
  }
}
