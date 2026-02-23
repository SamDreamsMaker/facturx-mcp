import { PDFDocument } from 'pdf-lib';
import { readFile, writeFile } from 'fs/promises';

/**
 * Crée un PDF avec le XML Factur-X en pièce jointe embarquée.
 * Retourne le PDF en bytes.
 */
export async function createFacturXPdf(
  xmlContent: string,
  sourcePdfPath?: string
): Promise<Uint8Array> {
  let pdfDoc: PDFDocument;

  if (sourcePdfPath) {
    const pdfBytes = await readFile(sourcePdfPath);
    pdfDoc = await PDFDocument.load(pdfBytes);
  } else {
    pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { height } = page.getSize();

    page.drawText('Factur-X — Facture Électronique', {
      x: 50,
      y: height - 80,
      size: 20,
    });
    page.drawText(
      'Ce document contient une facture structurée XML Factur-X en pièce jointe.',
      { x: 50, y: height - 120, size: 11 }
    );
    page.drawText(
      'Consultez la pièce jointe "factur-x.xml" pour les données structurées.',
      { x: 50, y: height - 140, size: 11 }
    );
  }

  await pdfDoc.attach(
    Buffer.from(xmlContent, 'utf-8'),
    'factur-x.xml',
    {
      mimeType: 'application/xml',
      description: 'Factur-X Invoice Data',
      creationDate: new Date(),
      modificationDate: new Date(),
    }
  );

  pdfDoc.setTitle('Factur-X Invoice');
  pdfDoc.setSubject('e-Facture / e-Invoice');
  pdfDoc.setKeywords(['Factur-X', 'e-Invoice', 'EN 16931', 'France']);
  pdfDoc.setCreator('facturx-mcp');

  return pdfDoc.save();
}

/**
 * Tente d'extraire le XML Factur-X embarqué dans un PDF.
 * Stratégie heuristique : recherche le contenu XML dans les bytes bruts du PDF.
 * Fonctionne pour les PDFs dont le stream XML n'est pas compressé (cas standard Factur-X).
 */
export async function extractXmlFromPdf(pdfPath: string): Promise<string | null> {
  const pdfBytes = await readFile(pdfPath);

  // Décoder en latin-1 pour accéder aux bytes bruts sans corruption
  const raw = Buffer.from(pdfBytes).toString('latin1');

  const xmlStart = raw.indexOf('<?xml');
  if (xmlStart === -1) return null;

  const closingTags = [
    '</rsm:CrossIndustryInvoice>',
    '</CrossIndustryInvoice>',
  ];

  for (const tag of closingTags) {
    const xmlEnd = raw.lastIndexOf(tag);
    if (xmlEnd !== -1) {
      const xmlRaw = raw.slice(xmlStart, xmlEnd + tag.length);
      return Buffer.from(xmlRaw, 'latin1').toString('utf-8');
    }
  }

  return null;
}

// Export writeFile pour utilisation dans index.ts
export { writeFile };
