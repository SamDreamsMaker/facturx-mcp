export interface ChorusConfig {
  clientId: string;
  clientSecret: string;
  login: string;      // Login PISTE (compte technique)
  password: string;   // Mot de passe PISTE
  sandbox: boolean;   // true = environnement bac à sable
}

export interface ChorusUploadResult {
  numeroFluxDepot?: string;
  dateDepot?: string;
  statutFlux?: string;
  erreursFlux?: Array<{
    codeErreur: string;
    libelleErreur: string;
  }>;
}

export interface ChorusInvoiceStatus {
  identifiantFactureCPP?: number;
  numeroFacture?: string;
  dateDepot?: string;
  statutFacture?: string;
  statutCourantCode?: string;
  statutCourantLibelle?: string;
  historique?: Array<{
    date: string;
    statut: string;
    commentaire?: string;
  }>;
}

export interface ChorusInvoiceListItem {
  identifiantFactureCPP?: number;
  numeroFacture?: string;
  dateDepot?: string;
  montantTTC?: number;
  devise?: string;
  statut?: string;
  siretEmetteur?: string;
  siretDestinataire?: string;
  designationEmetteur?: string;
  designationDestinataire?: string;
}

export interface ChorusInvoiceList {
  listeFactures?: ChorusInvoiceListItem[];
  nbTotalFactures?: number;
  nbFacturesParPage?: number;
  numeroPage?: number;
}
