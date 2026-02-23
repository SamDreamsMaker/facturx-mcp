import type { Invoice, ValidationResult } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const VAT_CATEGORY_CODES = new Set(['S', 'Z', 'E', 'K', 'G', 'O', 'L', 'M']);
const INVOICE_TYPE_CODES = new Set(['380', '381', '389', '384']);

export function validateInvoice(invoice: Invoice): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── En-tête ───────────────────────────────────────────────────────────
  if (!invoice.number?.trim())
    errors.push('BT-1 : Numéro de facture requis');
  if (!invoice.date?.match(DATE_RE))
    errors.push('BT-2 : Date de facture invalide (format attendu : YYYY-MM-DD)');
  if (!INVOICE_TYPE_CODES.has(invoice.typeCode))
    errors.push(`BT-3 : Code type facture invalide (valeurs : 380, 381, 389, 384)`);
  if (!invoice.currency?.match(CURRENCY_RE))
    errors.push('BT-5 : Code devise invalide (format ISO 4217, ex: EUR)');
  if (!invoice.profile)
    errors.push('Profil Factur-X requis (MINIMUM, BASIC, EN_16931, EXTENDED)');

  if (invoice.dueDate && !invoice.dueDate.match(DATE_RE))
    errors.push('BT-9 : Date d\'échéance invalide (format attendu : YYYY-MM-DD)');
  if (invoice.deliveryDate && !invoice.deliveryDate.match(DATE_RE))
    errors.push('Date de livraison invalide (format attendu : YYYY-MM-DD)');

  // ── Vendeur ───────────────────────────────────────────────────────────
  if (!invoice.seller?.name?.trim())
    errors.push('BT-27 : Nom du vendeur requis');
  if (!invoice.seller?.address?.street?.trim())
    errors.push('BT-35 : Adresse (rue) du vendeur requise');
  if (!invoice.seller?.address?.city?.trim())
    errors.push('BT-37 : Ville du vendeur requise');
  if (!invoice.seller?.address?.postalCode?.trim())
    errors.push('BT-38 : Code postal du vendeur requis');
  if (!invoice.seller?.address?.countryCode?.match(COUNTRY_RE))
    errors.push('BT-40 : Code pays vendeur invalide (format ISO 3166-1 alpha-2, ex: FR)');
  if (!invoice.seller?.vatNumber && !invoice.seller?.id)
    warnings.push('BT-31/BT-29 : Numéro de TVA ou identifiant vendeur recommandé pour le profil EN 16931');

  // ── Acheteur ──────────────────────────────────────────────────────────
  if (!invoice.buyer?.name?.trim())
    errors.push('BT-44 : Nom de l\'acheteur requis');
  if (!invoice.buyer?.address?.countryCode?.match(COUNTRY_RE))
    errors.push('BT-57 : Code pays acheteur invalide (format ISO 3166-1 alpha-2, ex: FR)');

  // ── Lignes ────────────────────────────────────────────────────────────
  if (!invoice.lines?.length) {
    errors.push('Au moins une ligne de facture est requise');
  } else {
    const lineIds = new Set<string>();
    for (let i = 0; i < invoice.lines.length; i++) {
      const line = invoice.lines[i];
      const ref = `Ligne ${line.id || i + 1}`;

      if (lineIds.has(line.id))
        errors.push(`${ref} : Identifiant de ligne dupliqué (BT-126)`);
      lineIds.add(line.id);

      if (!line.description?.trim())
        errors.push(`${ref} : Désignation requise (BT-153)`);
      if (typeof line.quantity !== 'number' || isNaN(line.quantity))
        errors.push(`${ref} : Quantité invalide (BT-129)`);
      if (!line.unitCode?.trim())
        errors.push(`${ref} : Code unité requis (BT-130) — ex: C62 (pièce), HUR (heure)`);
      if (typeof line.unitPrice !== 'number' || isNaN(line.unitPrice))
        errors.push(`${ref} : Prix unitaire invalide (BT-146)`);
      if (typeof line.totalAmount !== 'number' || isNaN(line.totalAmount))
        errors.push(`${ref} : Montant total ligne invalide (BT-131)`);
      if (typeof line.vatRate !== 'number' || line.vatRate < 0 || isNaN(line.vatRate))
        errors.push(`${ref} : Taux TVA invalide (BT-152) — doit être >= 0`);
      if (!VAT_CATEGORY_CODES.has(line.vatCategory))
        errors.push(`${ref} : Code catégorie TVA invalide (BT-151) — valeurs: S, Z, E, K, G, O`);

      // Cohérence montant ligne
      const expected = Math.round(line.quantity * line.unitPrice * 100) / 100;
      const actual = Math.round(line.totalAmount * 100) / 100;
      if (Math.abs(expected - actual) > 0.02) {
        warnings.push(
          `${ref} : Montant total (${actual}) ≠ quantité × prix unitaire (${expected}) — écart de ${Math.abs(expected - actual).toFixed(2)} €`
        );
      }
    }
  }

  // ── Paiement ──────────────────────────────────────────────────────────
  if (invoice.payment?.iban) {
    const iban = invoice.payment.iban.replace(/\s/g, '');
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(iban))
      warnings.push('BT-84 : Format IBAN potentiellement invalide');
  }

  return { valid: errors.length === 0, errors, warnings };
}
