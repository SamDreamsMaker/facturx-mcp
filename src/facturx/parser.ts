import { XMLParser } from 'fast-xml-parser';
import type { Invoice, InvoiceLine, TradeParty } from './types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  parseAttributeValue: false,
  allowBooleanAttributes: true,
});

function str(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const n = node as Record<string, unknown>;
    if ('#text' in n) return str(n['#text']);
  }
  return '';
}

function num(node: unknown): number {
  return parseFloat(str(node)) || 0;
}

function toIsoDate(node: unknown): string {
  const s = str(node);
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

function parseParty(raw: Record<string, unknown>): TradeParty {
  const addr = (raw['PostalTradeAddress'] ?? {}) as Record<string, unknown>;
  const taxReg = raw['SpecifiedTaxRegistration'] as Record<string, unknown> | undefined;
  const legalOrg = raw['SpecifiedLegalOrganization'] as Record<string, unknown> | undefined;

  return {
    name: str(raw['Name']),
    id: str(raw['ID']) || undefined,
    vatNumber: taxReg ? str(taxReg['ID']) || undefined : undefined,
    legalId: legalOrg ? str(legalOrg['ID']) || undefined : undefined,
    address: {
      street: str(addr['LineOne']),
      city: str(addr['CityName']),
      postalCode: str(addr['PostcodeCode']),
      countryCode: str(addr['CountryID']),
    },
  };
}

export function parseFacturXXml(xmlContent: string): Invoice {
  const parsed = xmlParser.parse(xmlContent) as Record<string, unknown>;

  const root =
    (parsed['CrossIndustryInvoice'] ?? parsed['rsm:CrossIndustryInvoice']) as Record<string, unknown>;
  if (!root) throw new Error('Document XML invalide : balise CrossIndustryInvoice introuvable');

  const doc = (root['ExchangedDocument'] ?? root['rsm:ExchangedDocument']) as Record<string, unknown>;
  const trx = (root['SupplyChainTradeTransaction'] ?? root['rsm:SupplyChainTradeTransaction']) as Record<string, unknown>;

  if (!doc || !trx) throw new Error('Structure Factur-X invalide : ExchangedDocument ou SupplyChainTradeTransaction manquant');

  const agreement  = (trx['ApplicableHeaderTradeAgreement']) as Record<string, unknown>;
  const delivery   = (trx['ApplicableHeaderTradeDelivery']) as Record<string, unknown>;
  const settlement = (trx['ApplicableHeaderTradeSettlement']) as Record<string, unknown>;

  // Lignes de facture
  let rawLines = trx['IncludedSupplyChainTradeLineItem'] ?? [];
  if (!Array.isArray(rawLines)) rawLines = [rawLines];

  const lines: InvoiceLine[] = (rawLines as Record<string, unknown>[]).map((l) => {
    const lineDoc       = (l['AssociatedDocumentLineDocument'] ?? {}) as Record<string, unknown>;
    const product       = (l['SpecifiedTradeProduct'] ?? {}) as Record<string, unknown>;
    const lineAgreement = (l['SpecifiedLineTradeAgreement'] ?? {}) as Record<string, unknown>;
    const lineDelivery  = (l['SpecifiedLineTradeDelivery'] ?? {}) as Record<string, unknown>;
    const lineSettlement= (l['SpecifiedLineTradeSettlement'] ?? {}) as Record<string, unknown>;

    const price = (lineAgreement['NetPriceProductTradePrice'] ?? {}) as Record<string, unknown>;
    const tax   = (lineSettlement['ApplicableTradeTax'] ?? {}) as Record<string, unknown>;
    const billed= lineDelivery['BilledQuantity'] as Record<string, unknown> | string | number;

    const billedQty  = typeof billed === 'object' ? str(billed) : str(billed);
    const billedUnit = typeof billed === 'object' ? str((billed as Record<string, unknown>)['@_unitCode']) : 'C62';

    const lineSummation = (lineSettlement['SpecifiedTradeSettlementLineMonetarySummation'] ?? {}) as Record<string, unknown>;

    return {
      id:          str(lineDoc['LineID']),
      description: str(product['Name']),
      quantity:    parseFloat(billedQty) || 0,
      unitCode:    billedUnit || 'C62',
      unitPrice:   num(price['ChargeAmount']),
      totalAmount: num(lineSummation['LineTotalAmount']),
      vatRate:     num(tax['RateApplicablePercent']),
      vatCategory: (str(tax['CategoryCode']) || 'S') as 'S',
      productId:   str(product['SellerAssignedID']) || undefined,
      note:        str(product['Description']) || undefined,
    };
  });

  // Paiement
  const paymentMeans = settlement['SpecifiedTradeSettlementPaymentMeans'] as Record<string, unknown> | undefined;
  const creditorAccount = paymentMeans?.['PayeePartyCreditorFinancialAccount'] as Record<string, unknown> | undefined;
  const paymentTerms = settlement['SpecifiedTradePaymentTerms'] as Record<string, unknown> | undefined;

  // Date livraison
  const deliveryEvent = (delivery?.['ActualDeliverySupplyChainEvent'] as Record<string, unknown>)?.['OccurrenceDateTime'] as Record<string, unknown> | undefined;
  const dueDateTime   = (paymentTerms?.['DueDateDateTime'] as Record<string, unknown>)?.['DateTimeString'];

  // Profil
  const ctx = (root['ExchangedDocumentContext'] ?? root['rsm:ExchangedDocumentContext']) as Record<string, unknown>;
  const guidelineId = str(
    ((ctx?.['GuidelineSpecifiedDocumentContextParameter'] as Record<string, unknown>)?.['ID'])
  );
  const profile = guidelineId.includes('en16931') ? 'EN_16931'
    : guidelineId.includes('extended') ? 'EXTENDED'
    : guidelineId.includes('basic')    ? 'BASIC'
    : guidelineId.includes('basicwl')  ? 'BASIC_WL'
    : guidelineId.includes('minimum')  ? 'MINIMUM'
    : 'EN_16931';

  const note = doc['IncludedNote'];
  const noteText = note ? str((note as Record<string, unknown>)['Content']) : undefined;

  return {
    number:      str(doc['ID']),
    typeCode:    (str(doc['TypeCode']) || '380') as '380',
    date:        toIsoDate((doc['IssueDateTime'] as Record<string, unknown>)?.['DateTimeString']),
    dueDate:     dueDateTime ? toIsoDate(dueDateTime) : undefined,
    deliveryDate:deliveryEvent ? toIsoDate(deliveryEvent['DateTimeString']) : undefined,
    currency:    str(settlement['InvoiceCurrencyCode']),
    profile:     profile as 'EN_16931',
    seller:      parseParty(agreement['SellerTradeParty'] as Record<string, unknown>),
    buyer:       parseParty(agreement['BuyerTradeParty'] as Record<string, unknown>),
    lines,
    payment: paymentMeans ? {
      meansCode:  (str(paymentMeans['TypeCode']) || '30') as '30',
      iban:       creditorAccount ? str(creditorAccount['IBANID']) || undefined : undefined,
      reference:  str(settlement['PaymentReference']) || undefined,
      terms:      paymentTerms ? str(paymentTerms['Description']) || undefined : undefined,
    } : undefined,
    purchaseOrderRef: str((agreement['BuyerOrderReferencedDocument'] as Record<string, unknown>)?.['IssuerAssignedID']) || undefined,
    contractRef:      str((agreement['ContractReferencedDocument'] as Record<string, unknown>)?.['IssuerAssignedID']) || undefined,
    buyerRef:         str(agreement['BuyerReference']) || undefined,
    notes:            noteText || undefined,
  };
}
