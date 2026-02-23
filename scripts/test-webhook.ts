/**
 * Script de test du webhook Polar → Vercel → licence → email
 * Usage : POLAR_WEBHOOK_SECRET=xxx tsx scripts/test-webhook.ts votre@email.com
 */
import crypto from 'crypto';

const WEBHOOK_URL = 'https://facturx-mcp.vercel.app/api/webhook';
const secret = process.env.POLAR_WEBHOOK_SECRET ?? '';
const testEmail = process.argv[2] ?? 'test@example.com';

if (!secret) {
  console.error('❌ POLAR_WEBHOOK_SECRET manquant');
  console.error('   Usage : POLAR_WEBHOOK_SECRET=votre_secret tsx scripts/test-webhook.ts votre@email.com');
  process.exit(1);
}

// Simuler un événement order.created de Polar.sh
const payload = {
  type: 'order.created',
  data: {
    id: crypto.randomUUID(),
    customer: { email: testEmail, name: 'Test Client' },
    product: { id: 'test-prod', name: 'facturx-mcp Pro' },
    amount: 999,   // 9.99€ en centimes → plan pro
    currency: 'eur',
  },
};

const body = JSON.stringify(payload);
const msgId = `test-${crypto.randomUUID()}`;
const msgTimestamp = String(Math.floor(Date.now() / 1000));

// Signature Standard Webhooks (même algo que Polar.sh)
const toSign = `${msgId}.${msgTimestamp}.${body}`;
const signature = crypto
  .createHmac('sha256', Buffer.from(secret, 'base64'))
  .update(toSign)
  .digest('base64');

console.log('📤 Envoi du webhook test...');
console.log(`   Email cible : ${testEmail}`);
console.log(`   Endpoint    : ${WEBHOOK_URL}`);
console.log('');

const response = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type':     'application/json',
    'webhook-id':        msgId,
    'webhook-timestamp': msgTimestamp,
    'webhook-signature': `v1,${signature}`,
  },
  body,
});

const text = await response.text();

if (response.ok) {
  console.log('✅ Webhook accepté par Vercel');
  console.log(`   Status : ${response.status}`);
  console.log(`   Body   : ${text}`);
  console.log('');
  console.log(`📧 Vérifiez votre boîte email : ${testEmail}`);
} else {
  console.error(`❌ Erreur ${response.status} : ${text}`);
}
