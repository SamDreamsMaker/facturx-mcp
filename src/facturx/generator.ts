import { create } from 'xmlbuilder2';
import type { Invoice, InvoiceTotals, VatSummary } from './types.js';

const PROFILE_URNS: Record<string, string> = {
  MINIMUM:  'urn:factur-x.eu:1p0:minimum',
  BASIC_WL: 'urn:factur-x.eu:1p0:basicwl',
  BASIC:    'urn:factur-x.eu:1p0:basic',
  EN_16931: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
};

// YYYYMMDD
function toDate8(iso: string): string {
  return iso.replace(/-/g, '');
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export function calculateTotals(invoice: Invoice): InvoiceTotals {
  const vatMap = new Map<string, VatSummary>();
  let lineTotalAmount = 0;

  for (const line of invoice.lines) {
    const lineTotal = Math.round(line.totalAmount * 100) / 100;
    lineTotalAmount += lineTotal;

    const key = `${line.vatCategory}-${line.vatRate}`;
    if (!vatMap.has(key)) {
      vatMap.set(key, {
        categoryCode: line.vatCategory,
        rate: line.vatRate,
        taxableAmount: 0,
        taxAmount: 0,
      });
    }
    vatMap.get(key)!.taxableAmount += lineTotal;
  }

  for (const vat of vatMap.values()) {
    vat.taxableAmount = Math.round(vat.taxableAmount * 100) / 100;
    vat.taxAmount = Math.round(vat.taxableAmount * vat.rate / 100 * 100) / 100;
  }

  const taxTotal = [...vatMap.values()].reduce((s, v) => s + v.taxAmount, 0);
  lineTotalAmount = Math.round(lineTotalAmount * 100) / 100;
  const grandTotal = Math.round((lineTotalAmount + taxTotal) * 100) / 100;

  return {
    lineTotalAmount,
    taxBasisTotalAmount: lineTotalAmount,
    taxTotalAmount: Math.round(taxTotal * 100) / 100,
    grandTotalAmount: grandTotal,
    duePayableAmount: grandTotal,
    vatSummaries: [...vatMap.values()],
  };
}

export function generateFacturX(invoice: Invoice): string {
  const totals = calculateTotals(invoice);
  const profileUrn = PROFILE_URNS[invoice.profile] ?? PROFILE_URNS.EN_16931;

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('rsm:CrossIndustryInvoice', {
      'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
      'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
      'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    });

  // ── ExchangedDocumentContext ──────────────────────────────────────────
  root.ele('rsm:ExchangedDocumentContext')
    .ele('ram:GuidelineSpecifiedDocumentContextParameter')
      .ele('ram:ID').txt(profileUrn).up()
    .up()
  .up();

  // ── ExchangedDocument ─────────────────────────────────────────────────
  const doc = root.ele('rsm:ExchangedDocument');
  doc.ele('ram:ID').txt(invoice.number);
  doc.ele('ram:TypeCode').txt(invoice.typeCode);
  doc.ele('ram:IssueDateTime')
    .ele('udt:DateTimeString', { format: '102' }).txt(toDate8(invoice.date)).up()
  .up();
  if (invoice.notes) {
    doc.ele('ram:IncludedNote')
      .ele('ram:Content').txt(invoice.notes).up()
    .up();
  }
  doc.up();

  // ── SupplyChainTradeTransaction ───────────────────────────────────────
  const trx = root.ele('rsm:SupplyChainTradeTransaction');

  // Lignes de facture
  for (const line of invoice.lines) {
    const li = trx.ele('ram:IncludedSupplyChainTradeLineItem');

    li.ele('ram:AssociatedDocumentLineDocument')
      .ele('ram:LineID').txt(line.id).up()
    .up();

    const product = li.ele('ram:SpecifiedTradeProduct');
    if (line.productId)      product.ele('ram:SellerAssignedID').txt(line.productId).up();
    if (line.buyerProductId) product.ele('ram:BuyerAssignedID').txt(line.buyerProductId).up();
    product.ele('ram:Name').txt(line.description).up();
    if (line.note) product.ele('ram:Description').txt(line.note).up();
    product.up();

    li.ele('ram:SpecifiedLineTradeAgreement')
      .ele('ram:NetPriceProductTradePrice')
        .ele('ram:ChargeAmount').txt(fmt(line.unitPrice)).up()
        .ele('ram:BasisQuantity', { unitCode: line.unitCode }).txt('1').up()
      .up()
    .up();

    li.ele('ram:SpecifiedLineTradeDelivery')
      .ele('ram:BilledQuantity', { unitCode: line.unitCode }).txt(String(line.quantity)).up()
    .up();

    li.ele('ram:SpecifiedLineTradeSettlement')
      .ele('ram:ApplicableTradeTax')
        .ele('ram:TypeCode').txt('VAT').up()
        .ele('ram:CategoryCode').txt(line.vatCategory).up()
        .ele('ram:RateApplicablePercent').txt(String(line.vatRate)).up()
      .up()
      .ele('ram:SpecifiedTradeSettlementLineMonetarySummation')
        .ele('ram:LineTotalAmount').txt(fmt(line.totalAmount)).up()
      .up()
    .up();

    li.up();
  }

  // ── ApplicableHeaderTradeAgreement ────────────────────────────────────
  const agreement = trx.ele('ram:ApplicableHeaderTradeAgreement');

  if (invoice.buyerRef) agreement.ele('ram:BuyerReference').txt(invoice.buyerRef).up();

  // Vendeur
  const seller = agreement.ele('ram:SellerTradeParty');
  if (invoice.seller.id) seller.ele('ram:ID').txt(invoice.seller.id).up();
  seller.ele('ram:Name').txt(invoice.seller.name).up();
  if (invoice.seller.legalId) {
    seller.ele('ram:SpecifiedLegalOrganization')
      .ele('ram:ID').txt(invoice.seller.legalId).up()
    .up();
  }
  if (invoice.seller.vatNumber) {
    seller.ele('ram:SpecifiedTaxRegistration')
      .ele('ram:ID', { schemeID: 'VA' }).txt(invoice.seller.vatNumber).up()
    .up();
  }
  seller.ele('ram:PostalTradeAddress')
    .ele('ram:PostcodeCode').txt(invoice.seller.address.postalCode).up()
    .ele('ram:LineOne').txt(invoice.seller.address.street).up()
    .ele('ram:CityName').txt(invoice.seller.address.city).up()
    .ele('ram:CountryID').txt(invoice.seller.address.countryCode).up()
  .up();
  if (invoice.seller.contact?.email) {
    seller.ele('ram:URIUniversalCommunication')
      .ele('ram:URIID', { schemeID: 'EM' }).txt(invoice.seller.contact.email).up()
    .up();
  }
  seller.up();

  // Acheteur
  const buyer = agreement.ele('ram:BuyerTradeParty');
  if (invoice.buyer.id) buyer.ele('ram:ID').txt(invoice.buyer.id).up();
  buyer.ele('ram:Name').txt(invoice.buyer.name).up();
  if (invoice.buyer.legalId) {
    buyer.ele('ram:SpecifiedLegalOrganization')
      .ele('ram:ID').txt(invoice.buyer.legalId).up()
    .up();
  }
  if (invoice.buyer.vatNumber) {
    buyer.ele('ram:SpecifiedTaxRegistration')
      .ele('ram:ID', { schemeID: 'VA' }).txt(invoice.buyer.vatNumber).up()
    .up();
  }
  buyer.ele('ram:PostalTradeAddress')
    .ele('ram:PostcodeCode').txt(invoice.buyer.address.postalCode).up()
    .ele('ram:LineOne').txt(invoice.buyer.address.street).up()
    .ele('ram:CityName').txt(invoice.buyer.address.city).up()
    .ele('ram:CountryID').txt(invoice.buyer.address.countryCode).up()
  .up();
  if (invoice.buyer.contact?.email) {
    buyer.ele('ram:URIUniversalCommunication')
      .ele('ram:URIID', { schemeID: 'EM' }).txt(invoice.buyer.contact.email).up()
    .up();
  }
  buyer.up();

  if (invoice.purchaseOrderRef) {
    agreement.ele('ram:BuyerOrderReferencedDocument')
      .ele('ram:IssuerAssignedID').txt(invoice.purchaseOrderRef).up()
    .up();
  }
  if (invoice.contractRef) {
    agreement.ele('ram:ContractReferencedDocument')
      .ele('ram:IssuerAssignedID').txt(invoice.contractRef).up()
    .up();
  }
  agreement.up();

  // ── ApplicableHeaderTradeDelivery ─────────────────────────────────────
  const delivery = trx.ele('ram:ApplicableHeaderTradeDelivery');
  if (invoice.deliveryDate) {
    delivery.ele('ram:ActualDeliverySupplyChainEvent')
      .ele('ram:OccurrenceDateTime')
        .ele('udt:DateTimeString', { format: '102' }).txt(toDate8(invoice.deliveryDate)).up()
      .up()
    .up();
  }
  delivery.up();

  // ── ApplicableHeaderTradeSettlement ───────────────────────────────────
  const settlement = trx.ele('ram:ApplicableHeaderTradeSettlement');

  if (invoice.payment?.reference) {
    settlement.ele('ram:PaymentReference').txt(invoice.payment.reference).up();
  }
  settlement.ele('ram:InvoiceCurrencyCode').txt(invoice.currency).up();

  if (invoice.payment) {
    const means = settlement.ele('ram:SpecifiedTradeSettlementPaymentMeans');
    means.ele('ram:TypeCode').txt(invoice.payment.meansCode).up();
    if (invoice.payment.iban) {
      means.ele('ram:PayeePartyCreditorFinancialAccount')
        .ele('ram:IBANID').txt(invoice.payment.iban.replace(/\s/g, '')).up()
      .up();
      if (invoice.payment.bic) {
        means.ele('ram:PayeeSpecifiedCreditorFinancialInstitution')
          .ele('ram:BICID').txt(invoice.payment.bic).up()
        .up();
      }
    }
    means.up();
  }

  // Ventilation TVA par taux
  for (const vat of totals.vatSummaries) {
    settlement.ele('ram:ApplicableTradeTax')
      .ele('ram:CalculatedAmount').txt(fmt(vat.taxAmount)).up()
      .ele('ram:TypeCode').txt('VAT').up()
      .ele('ram:BasisAmount').txt(fmt(vat.taxableAmount)).up()
      .ele('ram:CategoryCode').txt(vat.categoryCode).up()
      .ele('ram:RateApplicablePercent').txt(String(vat.rate)).up()
    .up();
  }

  // Conditions de paiement / échéance
  if (invoice.dueDate || invoice.payment?.terms) {
    const terms = settlement.ele('ram:SpecifiedTradePaymentTerms');
    if (invoice.payment?.terms) terms.ele('ram:Description').txt(invoice.payment.terms).up();
    if (invoice.dueDate) {
      terms.ele('ram:DueDateDateTime')
        .ele('udt:DateTimeString', { format: '102' }).txt(toDate8(invoice.dueDate)).up()
      .up();
    }
    terms.up();
  }

  // Totaux
  settlement.ele('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
    .ele('ram:LineTotalAmount').txt(fmt(totals.lineTotalAmount)).up()
    .ele('ram:TaxBasisTotalAmount').txt(fmt(totals.taxBasisTotalAmount)).up()
    .ele('ram:TaxTotalAmount', { currencyID: invoice.currency }).txt(fmt(totals.taxTotalAmount)).up()
    .ele('ram:GrandTotalAmount').txt(fmt(totals.grandTotalAmount)).up()
    .ele('ram:DuePayableAmount').txt(fmt(totals.duePayableAmount)).up()
  .up();

  settlement.up();
  trx.up();

  return root.end({ prettyPrint: true });
}
