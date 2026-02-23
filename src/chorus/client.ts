import type {
  ChorusConfig,
  ChorusUploadResult,
  ChorusInvoiceStatus,
  ChorusInvoiceList,
} from './types.js';

// URLs PISTE (API gateway officiel du gouvernement français)
const OAUTH_SANDBOX = 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token';
const OAUTH_PROD    = 'https://oauth.piste.gouv.fr/api/oauth/token';
const API_SANDBOX   = 'https://sandbox-api.chorus-pro.gouv.fr/api/cpro/factures/v1';
const API_PROD      = 'https://api.chorus-pro.gouv.fr/api/cpro/factures/v1';

export class ChorusClient {
  private config: ChorusConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: ChorusConfig) {
    this.config = config;
  }

  private get oauthUrl() {
    return this.config.sandbox ? OAUTH_SANDBOX : OAUTH_PROD;
  }

  private get apiUrl() {
    return this.config.sandbox ? API_SANDBOX : API_PROD;
  }

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 10_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type:    'password',
      client_id:     this.config.clientId,
      client_secret: this.config.clientSecret,
      username:      this.config.login,
      password:      this.config.password,
      scope:         'openid',
    });

    const res = await fetch(this.oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Erreur authentification PISTE (${res.status}) : ${text}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const token = await this.getToken();

    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json;charset=utf-8',
        'cpro-account':  this.config.login,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chorus Pro API (${res.status}) : ${text}`);
    }

    return res.json() as T;
  }

  /**
   * Dépose une facture Factur-X sur Chorus Pro.
   * @param xmlContent  Contenu XML de la facture
   * @param filename    Nom du fichier (ex: "facture-2024-001.xml")
   * @param syntax      Syntaxe du flux (défaut: EN16931)
   */
  async uploadInvoice(
    xmlContent: string,
    filename: string,
    syntax = 'EN16931'
  ): Promise<ChorusUploadResult> {
    const base64 = Buffer.from(xmlContent, 'utf-8').toString('base64');
    return this.post<ChorusUploadResult>('/deposerFluxFacture', {
      fichierFlux:   base64,
      nomFichier:    filename,
      syntaxeFlux:   syntax,
      avecSignature: false,
    });
  }

  /**
   * Récupère le statut détaillé d'une facture par son identifiant CPP.
   */
  async getInvoiceStatus(invoiceId: number): Promise<ChorusInvoiceStatus> {
    return this.post<ChorusInvoiceStatus>('/consulterCRDetaille', {
      identifiantFactureCPP: invoiceId,
    });
  }

  /**
   * Recherche des factures avec filtres optionnels.
   */
  async listInvoices(params: {
    dateDebut?: string;    // YYYY-MM-DD
    dateFin?: string;      // YYYY-MM-DD
    statut?: string;       // ex: "DEPOSEE", "EN_COURS_TRAITEMENT", "VALIDEE", "REJETEE"
    page?: number;
    nbParPage?: number;
  }): Promise<ChorusInvoiceList> {
    return this.post<ChorusInvoiceList>('/rechercherFactures', {
      dateDepotDebut:   params.dateDebut,
      dateDepotFin:     params.dateFin,
      statutFacture:    params.statut,
      numeroPage:       params.page ?? 1,
      nbResultatsParPage: params.nbParPage ?? 20,
    });
  }

  /**
   * Télécharge le XML d'une facture depuis Chorus Pro.
   */
  async downloadInvoice(invoiceId: number): Promise<string> {
    const result = await this.post<{ fichierFacture?: string }>(
      '/telechargerGroupeFacture',
      { identifiantFactureCPP: invoiceId }
    );
    if (!result.fichierFacture) throw new Error('Aucun fichier facture dans la réponse');
    return Buffer.from(result.fichierFacture, 'base64').toString('utf-8');
  }
}
