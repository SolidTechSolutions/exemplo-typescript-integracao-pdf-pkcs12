'use strict';
/**
 * [EN]    PAdES PDF signing — PKCS#12 pre-imported certificate.
 *         Dev  : npx ts-node src/index.ts
 *         Prod : npm run build && npm start
 *         Batch: POST http://localhost:8088/api/pdf/sign-pkcs12
 *         Form : POST http://localhost:8088/api/pdf/sign/form
 *
 * [PT-BR] Assinatura PAdES PDF — certificado PKCS#12 pré-importado.
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { PdfPkcs12Service } from './service';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const service = new PdfPkcs12Service();

app.post('/api/pdf/sign-pkcs12', async (_req: Request, res: Response) => {
  const inputPath = process.env.SOLIDSIGN_BATCH_INPUT_PATH ?? '';
  const outputPath = process.env.SOLIDSIGN_BATCH_OUTPUT_PATH ?? '';
  const certId = process.env.SOLIDSIGN_CERT_ID ?? '';
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory())
    return res.status(400).json({ error: `Invalid input path: ${inputPath}` });
  const pdfFiles = fs.readdirSync(inputPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(inputPath, f));
  if (!pdfFiles.length) return res.json({ message: `No PDF files found in ${inputPath}` });
  console.info(`Found ${pdfFiles.length} files for local processing.`);
  const result = await service.signPkcs12(pdfFiles, certId, outputPath);
  if (result) return res.json({ message: `Processing completed! ZIP generated at: ${result}` });
  return res.status(500).json({ error: 'Processing failed. Check logs.' });
});

app.post('/api/pdf/sign/form',
  upload.fields([{ name: 'document' }, { name: 'signatureImage' }]),
  async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const documents = files['document'] ?? [];
    const signatureImages = files['signatureImage'] ?? [];
    const b = req.body as Record<string, string>;
    const zip = await service.signPkcs12Form({
      authorization: b.authorization, baseUrl: b.baseUrl, pfxCode: b.pfxCode,
      documents, signatureImages,
      profile: b.profile, hashAlgorithm: b.hashAlgorithm, policyVersion: b.policyVersion,
      sigFieldMeasurementUnit: b.sigFieldMeasurementUnit, signatureFieldConfig: b.signatureFieldConfig,
      reason: b.reason, location: b.location, contact: b.contact,
      signatureFieldName: b.signatureFieldName, signatureTextConfig: b.signatureTextConfig,
      mdpPermissionLevel: b.mdpPermissionLevel, passwordsForDecryption: b.passwordsForDecryption,
      documentInfoMetadata: b.documentInfoMetadata, signatureQrCodeConfig: b.signatureQrCodeConfig,
    });
    if (zip) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename=signed_pdf.zip');
      return res.send(zip);
    }
    return res.status(500).json({ error: 'Processing failed. Check logs.' });
  }
);

const PORT = Number(process.env.PORT ?? 8088);
app.listen(PORT, () => console.info(`SolidSign PDF PKCS12 (TS) running on port ${PORT}`));
