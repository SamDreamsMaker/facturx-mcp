#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { writeFile } from 'fs/promises';

import { generateFacturX, calculateTotals } from './facturx/generator.js';
import { validateInvoice } from './facturx/validator.js';
import { parseFacturXXml } from './facturx/parser.js';
import { createFacturXPdf, extractXmlFromPdf } from './facturx/pdf.js';
import { ChorusClient } from './chorus/client.js';
import type { Invoice } from './facturx/types.js';
import type { ChorusConfig } from './chorus/types.js';
import {
  validateLicenseKey,
  PRO_TOOLS,
  buildUpgradeMessage,
  type LicenseResult,
} from './license.js';
import {
  checkFreeQuota,
  incrementFreeUsage,
  buildQuotaMessage,
} from './usage.js';

// ── Configuration Chorus Pro depuis les variables d'environnement ──────────
function getChorusClient(): ChorusClient {
  const { CHORUS_CLIENT_ID, CHORUS_CLIENT_SECRET, CHORUS_LOGIN, CHORUS_PASSWORD } = process.env;
  if (!CHORUS_CLIENT_ID || !CHORUS_CLIENT_SECRET || !CHORUS_LOGIN || !CHORUS_PASSWORD) {
    throw new Error(
      'Variables d\'environnement Chorus Pro manquantes : ' +
      'CHORUS_CLIENT_ID, CHORUS_CLIENT_SECRET, CHORUS_LOGIN, CHORUS_PASSWORD'
    );
  }
  const config: ChorusConfig = {
    clientId: CHORUS_CLIENT_ID,
    clientSecret: CHORUS_CLIENT_SECRET,
    login: CHORUS_LOGIN,
    password: CHORUS_PASSWORD,
    sandbox: process.env.CHORUS_SANDBOX !== 'false',
  };
  return new ChorusClient(config);
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function err(message: string) {
  return { content: [{ type: 'text' as const, text: `❌ Erreur : ${message}` }], isError: true };
}

// ── Définitions des outils ────────────────────────────────────────────────
const partySchema = {
  type: 'object' as const,
  required: ['name', 'address'],
  properties: {
    name:       { type: 'string', description: 'Raison sociale' },
    id:         { type: 'string', description: 'SIRET (14 chiffres)' },
    vatNumber:  { type: 'string', description: 'Numéro TVA intracommunautaire (ex: FR12345678901)' },
    legalId:    { type: 'string', description: 'Identifiant légal (SIREN, RCS…)' },
    address: {
      type: 'object',
      required: ['street', 'city', 'postalCode', 'countryCode'],
      properties: {
        street:      { type: 'string' },
        city:        { type: 'string' },
        postalCode:  { type: 'string' },
        countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 (ex: FR)' },
      },
    },
    contact: {
      type: 'object',
      properties: {
        name:  { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
};

const lineSchema = {
  type: 'object' as const,
  required: ['id', 'description', 'quantity', 'unitCode', 'unitPrice', 'totalAmount', 'vatRate', 'vatCategory'],
  properties: {
    id:             { type: 'string', description: 'Identifiant ligne (ex: "1", "2")' },
    description:    { type: 'string', description: 'Désignation du produit/service' },
    quantity:       { type: 'number' },
    unitCode:       { type: 'string', description: 'Code unité UN/ECE (C62=pièce, HUR=heure, KGM=kg, MTR=mètre, DAY=jour)' },
    unitPrice:      { type: 'number', description: 'Prix unitaire HT' },
    totalAmount:    { type: 'number', description: 'Montant total ligne HT (quantity × unitPrice)' },
    vatRate:        { type: 'number', description: 'Taux TVA en % (ex: 20, 10, 5.5, 0)' },
    vatCategory:    { type: 'string', enum: ['S', 'Z', 'E', 'K', 'G', 'O'], description: 'S=standard, Z=zéro, E=exonéré, K=intracommunautaire' },
    productId:      { type: 'string', description: 'Référence article fournisseur' },
    buyerProductId: { type: 'string', description: 'Référence article acheteur' },
    note:           { type: 'string', description: 'Note/description complémentaire' },
  },
};

const invoiceInputSchema = {
  type: 'object' as const,
  required: ['number', 'date', 'currency', 'seller', 'buyer', 'lines'],
  properties: {
    number:           { type: 'string', description: 'Numéro de facture unique' },
    typeCode:         { type: 'string', enum: ['380', '381', '389', '384'], description: '380=facture, 381=avoir, 389=auto-facturation', default: '380' },
    date:             { type: 'string', description: 'Date d\'émission (YYYY-MM-DD)' },
    dueDate:          { type: 'string', description: 'Date d\'échéance (YYYY-MM-DD)' },
    deliveryDate:     { type: 'string', description: 'Date de livraison (YYYY-MM-DD)' },
    currency:         { type: 'string', description: 'Code devise ISO 4217', default: 'EUR' },
    profile:          { type: 'string', enum: ['MINIMUM', 'BASIC_WL', 'BASIC', 'EN_16931', 'EXTENDED'], description: 'Profil Factur-X', default: 'EN_16931' },
    seller:           partySchema,
    buyer:            partySchema,
    lines:            { type: 'array', items: lineSchema, minItems: 1 },
    purchaseOrderRef: { type: 'string', description: 'Référence bon de commande' },
    contractRef:      { type: 'string', description: 'Référence contrat' },
    buyerRef:         { type: 'string', description: 'Référence interne acheteur' },
    notes:            { type: 'string', description: 'Notes libres sur la facture' },
    payment: {
      type: 'object',
      properties: {
        meansCode: { type: 'string', enum: ['30', '31', '42', '48', '49', '57', '58', '59'], description: '30=virement, 58=SEPA Credit Transfer, 48=carte bancaire' },
        iban:      { type: 'string', description: 'IBAN du compte à créditer' },
        bic:       { type: 'string', description: 'BIC/SWIFT' },
        reference: { type: 'string', description: 'Référence de paiement' },
        terms:     { type: 'string', description: 'Conditions de paiement (texte)' },
      },
    },
  },
};

const TOOLS: Tool[] = [
  {
    name: 'facturx_generate',
    description:
      'Génère un fichier XML Factur-X valide (norme EN 16931 / UE) à partir des données de facturation. ' +
      'Calcule automatiquement les totaux HT, TVA et TTC. Retourne le XML et un résumé des montants.',
    inputSchema: invoiceInputSchema,
  },
  {
    name: 'facturx_validate',
    description:
      'Valide les données d\'une facture avant génération : vérifie les champs obligatoires, ' +
      'les formats (dates, codes pays, TVA), la cohérence des montants lignes. ' +
      'Retourne les erreurs bloquantes et les avertissements.',
    inputSchema: invoiceInputSchema,
  },
  {
    name: 'facturx_parse',
    description:
      'Parse un fichier XML Factur-X et extrait toutes les données de facturation sous forme JSON structuré. ' +
      'Compatible avec les profils MINIMUM, BASIC, EN 16931 et EXTENDED.',
    inputSchema: {
      type: 'object',
      required: ['xmlContent'],
      properties: {
        xmlContent: { type: 'string', description: 'Contenu XML Factur-X à parser' },
      },
    },
  },
  {
    name: 'facturx_compute_totals',
    description:
      'Calcule les totaux d\'une facture (HT par ligne, sous-total HT, TVA ventilée par taux, TTC, montant à payer). ' +
      'Utile pour vérifier les montants avant génération.',
    inputSchema: {
      type: 'object',
      required: ['lines', 'currency'],
      properties: {
        currency: { type: 'string', description: 'Code devise (ex: EUR)', default: 'EUR' },
        lines: { type: 'array', items: lineSchema },
      },
    },
  },
  {
    name: 'facturx_create_pdf',
    description:
      'Crée un PDF avec le XML Factur-X embarqué en pièce jointe (format requis par la norme). ' +
      'Optionnellement, peut intégrer le XML dans un PDF existant. Sauvegarde le résultat sur disque.',
    inputSchema: {
      type: 'object',
      required: ['xmlContent', 'outputPath'],
      properties: {
        xmlContent:    { type: 'string', description: 'Contenu XML Factur-X' },
        outputPath:    { type: 'string', description: 'Chemin de sortie du PDF (ex: /tmp/facture.pdf)' },
        sourcePdfPath: { type: 'string', description: 'Optionnel : chemin d\'un PDF existant à enrichir avec le XML' },
      },
    },
  },
  {
    name: 'facturx_extract_from_pdf',
    description:
      'Extrait le XML Factur-X embarqué dans un PDF. Retourne le contenu XML.',
    inputSchema: {
      type: 'object',
      required: ['pdfPath'],
      properties: {
        pdfPath: { type: 'string', description: 'Chemin vers le fichier PDF Factur-X' },
      },
    },
  },
  {
    name: 'chorus_submit',
    description:
      'Soumet une facture Factur-X sur la plateforme Chorus Pro (obligatoire pour facturer l\'État français). ' +
      'Requiert les variables d\'environnement CHORUS_CLIENT_ID, CHORUS_CLIENT_SECRET, CHORUS_LOGIN, CHORUS_PASSWORD.',
    inputSchema: {
      type: 'object',
      required: ['xmlContent', 'filename'],
      properties: {
        xmlContent: { type: 'string', description: 'Contenu XML de la facture' },
        filename:   { type: 'string', description: 'Nom du fichier (ex: facture-2024-001.xml)' },
        syntax:     { type: 'string', description: 'Syntaxe du flux (défaut: EN16931)', default: 'EN16931' },
      },
    },
  },
  {
    name: 'chorus_get_status',
    description:
      'Récupère le statut de traitement d\'une facture soumise sur Chorus Pro (identifiant CPP retourné lors du dépôt). ' +
      'Statuts possibles : DEPOSEE, EN_COURS_TRAITEMENT, VALIDEE, REJETEE.',
    inputSchema: {
      type: 'object',
      required: ['invoiceId'],
      properties: {
        invoiceId: { type: 'number', description: 'Identifiant facture Chorus Pro (identifiantFactureCPP)' },
      },
    },
  },
  {
    name: 'chorus_list_invoices',
    description:
      'Liste les factures présentes sur Chorus Pro avec filtres optionnels par date, statut et pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        dateDebut:  { type: 'string', description: 'Date de dépôt début (YYYY-MM-DD)' },
        dateFin:    { type: 'string', description: 'Date de dépôt fin (YYYY-MM-DD)' },
        statut:     { type: 'string', description: 'Filtre statut : DEPOSEE, EN_COURS_TRAITEMENT, VALIDEE, REJETEE, SUSPENDUE' },
        page:       { type: 'number', description: 'Numéro de page (défaut: 1)', default: 1 },
        nbParPage:  { type: 'number', description: 'Nombre de résultats par page (défaut: 20)', default: 20 },
      },
    },
  },
];

// ── Licence : validation au démarrage ────────────────────────────────────────
const RAW_LICENSE_KEY = process.env.FACTURX_LICENSE_KEY ?? '';
let currentLicense: LicenseResult = { valid: false, plan: 'free' };

if (RAW_LICENSE_KEY) {
  currentLicense = validateLicenseKey(RAW_LICENSE_KEY);
  if (currentLicense.valid) {
    console.error(
      `✅ Licence ${currentLicense.plan.toUpperCase()} validée` +
      ` — ${currentLicense.email} — expire le ${currentLicense.expiresAt?.toISOString().slice(0, 10)}` +
      ` (${currentLicense.daysLeft} jours)`
    );
  } else {
    console.error(`⚠ Licence invalide : ${currentLicense.error} — mode gratuit actif`);
  }
} else {
  console.error('ℹ Aucune licence — mode gratuit (10 générations/jour)');
}

// ── Serveur MCP ────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'facturx-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // ── Vérification licence pour les outils Pro ────────────────────────────
  if (PRO_TOOLS.has(name) && !currentLicense.valid) {
    return {
      content: [{ type: 'text' as const, text: buildUpgradeMessage(name, currentLicense) }],
      isError: true,
    };
  }

  try {
    switch (name) {

      // ── facturx_generate ───────────────────────────────────────────────
      case 'facturx_generate': {
        // Quota journalier pour le tier gratuit
        if (!currentLicense.valid) {
          const quota = await checkFreeQuota();
          if (!quota.allowed) {
            return {
              content: [{ type: 'text' as const, text: buildQuotaMessage(quota.used, quota.limit) }],
              isError: true,
            };
          }
        }

        const invoice = args as unknown as Invoice;
        if (!invoice.typeCode) invoice.typeCode = '380';
        if (!invoice.profile)  invoice.profile  = 'EN_16931';

        const validation = validateInvoice(invoice);
        if (!validation.valid) {
          return err(
            'Facture invalide :\n' +
            validation.errors.map(e => `  • ${e}`).join('\n') +
            (validation.warnings.length
              ? '\n\nAvertissements :\n' + validation.warnings.map(w => `  ⚠ ${w}`).join('\n')
              : '')
          );
        }

        const xml = generateFacturX(invoice);
        const totals = calculateTotals(invoice);

        // Incrémenter le compteur journalier (tier gratuit uniquement)
        if (!currentLicense.valid) await incrementFreeUsage();

        const summary = [
          `✅ Facture Factur-X générée avec succès`,
          ``,
          `📄 Référence : ${invoice.number}`,
          `📅 Date      : ${invoice.date}${invoice.dueDate ? ` → échéance ${invoice.dueDate}` : ''}`,
          `🏢 Vendeur   : ${invoice.seller.name}`,
          `🏢 Acheteur  : ${invoice.buyer.name}`,
          ``,
          `💰 Totaux :`,
          `  Sous-total HT   : ${totals.lineTotalAmount.toFixed(2)} ${invoice.currency}`,
          ...totals.vatSummaries.map(v =>
            `  TVA ${v.rate}%         : ${v.taxAmount.toFixed(2)} ${invoice.currency} (base ${v.taxableAmount.toFixed(2)})`
          ),
          `  Total TTC       : ${totals.grandTotalAmount.toFixed(2)} ${invoice.currency}`,
          `  Montant à payer : ${totals.duePayableAmount.toFixed(2)} ${invoice.currency}`,
          ``,
          validation.warnings.length
            ? `⚠ Avertissements :\n${validation.warnings.map(w => `  ${w}`).join('\n')}\n`
            : '',
          `--- XML Factur-X ---`,
          xml,
        ].join('\n');

        return ok(summary);
      }

      // ── facturx_validate ───────────────────────────────────────────────
      case 'facturx_validate': {
        const invoice = args as unknown as Invoice;
        const result = validateInvoice(invoice);

        const lines: string[] = [];
        if (result.valid) {
          lines.push('✅ Facture valide — prête pour la génération Factur-X');
        } else {
          lines.push(`❌ ${result.errors.length} erreur(s) bloquante(s) :`);
          result.errors.forEach(e => lines.push(`  • ${e}`));
        }
        if (result.warnings.length) {
          lines.push('');
          lines.push(`⚠ ${result.warnings.length} avertissement(s) :`);
          result.warnings.forEach(w => lines.push(`  ⚠ ${w}`));
        }

        return ok(lines.join('\n'));
      }

      // ── facturx_parse ──────────────────────────────────────────────────
      case 'facturx_parse': {
        const { xmlContent } = args as { xmlContent: string };
        if (!xmlContent?.trim()) return err('xmlContent ne peut pas être vide');

        const invoice = parseFacturXXml(xmlContent);
        const totals  = calculateTotals(invoice);

        const lines = [
          `✅ XML Factur-X parsé avec succès`,
          ``,
          `📄 Numéro    : ${invoice.number}`,
          `📅 Date      : ${invoice.date}${invoice.dueDate ? ` (échéance: ${invoice.dueDate})` : ''}`,
          `💱 Devise    : ${invoice.currency}`,
          `📋 Profil    : ${invoice.profile}`,
          ``,
          `🏢 Vendeur   : ${invoice.seller.name}${invoice.seller.vatNumber ? ` — TVA: ${invoice.seller.vatNumber}` : ''}`,
          `🏢 Acheteur  : ${invoice.buyer.name}${invoice.buyer.vatNumber ? ` — TVA: ${invoice.buyer.vatNumber}` : ''}`,
          ``,
          `📦 ${invoice.lines.length} ligne(s) :`,
          ...invoice.lines.map(l =>
            `  [${l.id}] ${l.description} — ${l.quantity} ${l.unitCode} × ${l.unitPrice.toFixed(2)} = ${l.totalAmount.toFixed(2)} (TVA ${l.vatRate}%)`
          ),
          ``,
          `💰 Totaux :`,
          `  HT  : ${totals.lineTotalAmount.toFixed(2)} ${invoice.currency}`,
          `  TVA : ${totals.taxTotalAmount.toFixed(2)} ${invoice.currency}`,
          `  TTC : ${totals.grandTotalAmount.toFixed(2)} ${invoice.currency}`,
          ``,
          `--- Données JSON ---`,
          JSON.stringify(invoice, null, 2),
        ];

        return ok(lines.join('\n'));
      }

      // ── facturx_compute_totals ─────────────────────────────────────────
      case 'facturx_compute_totals': {
        const { lines, currency = 'EUR' } = args as {
          lines: Invoice['lines'];
          currency: string;
        };
        if (!lines?.length) return err('Au moins une ligne est requise');

        const fakeInvoice: Invoice = {
          number: 'PREVIEW', typeCode: '380', date: '2024-01-01',
          currency, profile: 'EN_16931',
          seller: { name: '-', address: { street: '-', city: '-', postalCode: '-', countryCode: 'FR' } },
          buyer:  { name: '-', address: { street: '-', city: '-', postalCode: '-', countryCode: 'FR' } },
          lines,
        };
        const totals = calculateTotals(fakeInvoice);

        const result = [
          `💰 Calcul des totaux`,
          ``,
          `Lignes :`,
          ...lines.map(l =>
            `  [${l.id}] ${l.description} : ${l.quantity} × ${l.unitPrice.toFixed(2)} = ${l.totalAmount.toFixed(2)} ${currency} (TVA ${l.vatRate}%)`
          ),
          ``,
          `Ventilation TVA :`,
          ...totals.vatSummaries.map(v =>
            `  Taux ${v.rate}% : base ${v.taxableAmount.toFixed(2)} → TVA ${v.taxAmount.toFixed(2)} ${currency}`
          ),
          ``,
          `  Sous-total HT   : ${totals.lineTotalAmount.toFixed(2)} ${currency}`,
          `  Total TVA       : ${totals.taxTotalAmount.toFixed(2)} ${currency}`,
          `  ─────────────────────────────`,
          `  Total TTC       : ${totals.grandTotalAmount.toFixed(2)} ${currency}`,
        ];

        return ok(result.join('\n'));
      }

      // ── facturx_create_pdf ─────────────────────────────────────────────
      case 'facturx_create_pdf': {
        const { xmlContent, outputPath, sourcePdfPath } = args as {
          xmlContent: string;
          outputPath: string;
          sourcePdfPath?: string;
        };
        if (!xmlContent?.trim()) return err('xmlContent ne peut pas être vide');
        if (!outputPath?.trim()) return err('outputPath est requis');

        const pdfBytes = await createFacturXPdf(xmlContent, sourcePdfPath);
        await writeFile(outputPath, pdfBytes);

        return ok(
          `✅ PDF Factur-X créé avec succès\n` +
          `📄 Fichier : ${outputPath}\n` +
          `📎 XML Factur-X embarqué : factur-x.xml\n` +
          `📦 Taille : ${(pdfBytes.length / 1024).toFixed(1)} Ko`
        );
      }

      // ── facturx_extract_from_pdf ───────────────────────────────────────
      case 'facturx_extract_from_pdf': {
        const { pdfPath } = args as { pdfPath: string };
        if (!pdfPath?.trim()) return err('pdfPath est requis');

        const xml = await extractXmlFromPdf(pdfPath);
        if (!xml) {
          return err(
            'Aucun XML Factur-X trouvé dans ce PDF. ' +
            'Vérifiez que le fichier est bien un PDF Factur-X avec une pièce jointe XML.'
          );
        }

        return ok(`✅ XML Factur-X extrait avec succès\n\n${xml}`);
      }

      // ── chorus_submit ──────────────────────────────────────────────────
      case 'chorus_submit': {
        const { xmlContent, filename, syntax } = args as {
          xmlContent: string;
          filename: string;
          syntax?: string;
        };
        if (!xmlContent?.trim()) return err('xmlContent ne peut pas être vide');
        if (!filename?.trim())   return err('filename est requis');

        const chorus = getChorusClient();
        const result = await chorus.uploadInvoice(xmlContent, filename, syntax);

        const lines = [
          `✅ Facture soumise sur Chorus Pro`,
          ``,
          `📋 Numéro flux dépôt : ${result.numeroFluxDepot ?? 'N/A'}`,
          `📅 Date de dépôt     : ${result.dateDepot ?? 'N/A'}`,
          `🔄 Statut flux       : ${result.statutFlux ?? 'N/A'}`,
        ];

        if (result.erreursFlux?.length) {
          lines.push('', '⚠ Erreurs signalées :');
          result.erreursFlux.forEach(e =>
            lines.push(`  • [${e.codeErreur}] ${e.libelleErreur}`)
          );
        }

        return ok(lines.join('\n'));
      }

      // ── chorus_get_status ──────────────────────────────────────────────
      case 'chorus_get_status': {
        const { invoiceId } = args as { invoiceId: number };
        const chorus = getChorusClient();
        const status = await chorus.getInvoiceStatus(invoiceId);

        return ok(
          `✅ Statut facture Chorus Pro\n\n` +
          JSON.stringify(status, null, 2)
        );
      }

      // ── chorus_list_invoices ───────────────────────────────────────────
      case 'chorus_list_invoices': {
        const { dateDebut, dateFin, statut, page, nbParPage } = args as {
          dateDebut?: string;
          dateFin?: string;
          statut?: string;
          page?: number;
          nbParPage?: number;
        };
        const chorus = getChorusClient();
        const list = await chorus.listInvoices({ dateDebut, dateFin, statut, page, nbParPage });

        const factures = list.listeFactures ?? [];
        const lines = [
          `📋 ${list.nbTotalFactures ?? 0} facture(s) trouvée(s) — page ${list.numeroPage ?? 1}`,
          ``,
        ];
        if (factures.length === 0) {
          lines.push('Aucune facture pour ces critères.');
        } else {
          factures.forEach(f => {
            lines.push(
              `  [${f.identifiantFactureCPP ?? '?'}] ${f.numeroFacture ?? '?'} ` +
              `| ${f.dateDepot ?? '?'} | ${f.statut ?? '?'} ` +
              `| ${f.montantTTC?.toFixed(2) ?? '?'} ${f.devise ?? ''} ` +
              `| ${f.designationEmetteur ?? ''} → ${f.designationDestinataire ?? ''}`
            );
          });
        }

        return ok(lines.join('\n'));
      }

      default:
        return err(`Outil inconnu : ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
});

// ── Démarrage ──────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ facturx-mcp démarré (stdio)');
}

main().catch((error) => {
  console.error('Erreur fatale :', error);
  process.exit(1);
});
