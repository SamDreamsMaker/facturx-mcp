# facturx-mcp

**Serveur MCP pour la facturation électronique Factur-X** — générez, validez et soumettez des factures conformes à la norme EN 16931 et à la réforme française B2B 2026 directement depuis Claude.

## Installation

```bash
npm install -g facturx-mcp
```

## Configuration Claude Desktop

Ajoutez dans `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows) :

```json
{
  "mcpServers": {
    "facturx": {
      "command": "facturx-mcp",
      "env": {
        "FACTURX_LICENSE_KEY": "FTRX-..."
      }
    }
  }
}
```

Sans clé de licence, le mode gratuit est actif (10 générations/jour).

## Outils disponibles

| Outil | Plan | Description |
|-------|------|-------------|
| `facturx_generate` | Gratuit (10/j) | Générer un XML Factur-X valide (EN 16931) |
| `facturx_validate` | Gratuit | Valider les données avant génération |
| `facturx_parse` | Gratuit | Parser un XML Factur-X existant |
| `facturx_compute_totals` | Gratuit | Calculer HT / TVA / TTC |
| `facturx_create_pdf` | **Pro** | Créer un PDF avec XML embarqué |
| `facturx_extract_from_pdf` | **Pro** | Extraire le XML depuis un PDF |
| `chorus_submit` | **Pro** | Soumettre sur Chorus Pro (B2G) |
| `chorus_get_status` | **Pro** | Statut d'une facture CPP |
| `chorus_list_invoices` | **Pro** | Lister les factures Chorus Pro |

## Tarifs

- **Gratuit** — 10 générations/jour, outils Factur-X de base
- **Pro — 9.99 €/mois** — Outils illimités + Chorus Pro → [Acheter maintenant](https://buy.polar.sh/polar_cl_hhTVyZpvFsZ2jlddR0OZz0ZP4KG9FuebS5OYp0mKRNR)
- **Enterprise — 49.99 €/mois** — Multi-comptes Chorus Pro + support prioritaire

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|------------|-------------|
| `FACTURX_LICENSE_KEY` | Non | Clé de licence Pro (format `FTRX-...`) |
| `CHORUS_CLIENT_ID` | Pro | Client ID PISTE (Chorus Pro) |
| `CHORUS_CLIENT_SECRET` | Pro | Client Secret PISTE |
| `CHORUS_LOGIN` | Pro | Login compte technique Chorus Pro |
| `CHORUS_PASSWORD` | Pro | Mot de passe compte technique |
| `CHORUS_SANDBOX` | Non | `true` pour le bac à sable (défaut: `true`) |

## Exemple

```
Génère une facture pour ma prestation du mois :
- Vendeur : ACME SAS, TVA FR12345678901, 10 rue de la Paix 75001 Paris
- Acheteur : CLIENT SA, 5 av. des Champs 69001 Lyon
- 10h de développement à 150€/h HT, TVA 20%
- Paiement à 30 jours, IBAN FR76...
```

Claude utilise automatiquement `facturx_generate` et retourne le XML Factur-X prêt à l'emploi.

## Conformité

- Norme **EN 16931** (directive européenne 2014/55/UE)
- Compatible **Factur-X** profils : MINIMUM, BASIC, EN\_16931, EXTENDED
- Compatible **ZUGFeRD** 2.x (Allemagne)
- Prêt pour la **réforme française e-facturation B2B** (septembre 2026)
- Intégration **Chorus Pro** (facturation B2G)

## Licence

MIT — © 2026 facturx-mcp
