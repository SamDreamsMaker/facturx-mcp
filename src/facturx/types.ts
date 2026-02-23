export type VatCategoryCode = 'S' | 'Z' | 'E' | 'K' | 'G' | 'O' | 'L' | 'M';
export type InvoiceTypeCode = '380' | '381' | '389' | '384';
export type FacturXProfile = 'MINIMUM' | 'BASIC_WL' | 'BASIC' | 'EN_16931' | 'EXTENDED';
export type PaymentMeansCode = '30' | '31' | '42' | '48' | '49' | '57' | '58' | '59';

export interface TradePartyAddress {
  street: string;
  additionalStreet?: string;
  city: string;
  postalCode: string;
  countryCode: string; // ISO 3166-1 alpha-2 (e.g. "FR")
  stateOrProvince?: string;
}

export interface TradeParty {
  name: string;
  id?: string;         // SIRET (14 chiffres)
  vatNumber?: string;  // Numéro de TVA intracommunautaire (ex: "FR12345678901")
  legalId?: string;    // Identifiant légal (RCS, SIREN)
  address: TradePartyAddress;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitCode: string;       // UN/ECE rec 20 (ex: "C62"=pièce, "HUR"=heure, "KGM"=kg, "MTR"=mètre)
  unitPrice: number;      // Prix unitaire net HT
  totalAmount: number;    // Montant total ligne HT (quantity × unitPrice)
  vatRate: number;        // Taux de TVA en % (ex: 20, 10, 5.5, 0)
  vatCategory: VatCategoryCode;
  productId?: string;     // Référence article fournisseur
  buyerProductId?: string; // Référence article acheteur
  note?: string;
}

export interface PaymentInfo {
  meansCode: PaymentMeansCode; // 30=virement, 58=SEPA, 48=carte
  iban?: string;
  bic?: string;
  reference?: string;     // Référence de paiement
  terms?: string;         // Conditions de paiement (texte libre)
}

export interface Invoice {
  number: string;
  typeCode: InvoiceTypeCode; // 380=facture, 381=avoir, 389=auto-facturation
  date: string;              // YYYY-MM-DD
  dueDate?: string;          // YYYY-MM-DD
  deliveryDate?: string;     // YYYY-MM-DD
  currency: string;          // ISO 4217 (ex: "EUR")
  profile: FacturXProfile;
  seller: TradeParty;
  buyer: TradeParty;
  lines: InvoiceLine[];
  payment?: PaymentInfo;
  purchaseOrderRef?: string;  // Référence bon de commande
  contractRef?: string;       // Référence contrat
  notes?: string;
  buyerRef?: string;          // Référence interne acheteur
}

export interface VatSummary {
  categoryCode: VatCategoryCode;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface InvoiceTotals {
  lineTotalAmount: number;
  taxBasisTotalAmount: number;
  taxTotalAmount: number;
  grandTotalAmount: number;
  duePayableAmount: number;
  vatSummaries: VatSummary[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
