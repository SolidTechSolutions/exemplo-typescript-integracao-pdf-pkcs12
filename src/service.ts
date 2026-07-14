'use strict';
import axios from 'axios';
import FormData from 'form-data';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

interface SignLink { rel: string; href: string; }
interface SignDocument { links: SignLink[]; }
interface SignResponse { documents: SignDocument[]; identifier?: string; }

interface FormSignParams {
  authorization: string; baseUrl: string; pfxCode: string;
  documents: Express.Multer.File[]; signatureImages?: Express.Multer.File[];
  profile?: string; hashAlgorithm?: string; policyVersion?: string;
  sigFieldMeasurementUnit?: string; signatureFieldConfig?: string;
  reason?: string; location?: string; contact?: string;
  signatureFieldName?: string; signatureTextConfig?: string;
  mdpPermissionLevel?: string; passwordsForDecryption?: string;
  documentInfoMetadata?: string; signatureQrCodeConfig?: string;
}

// [EN]    Sends a visual-signature config as INDEXED fields: key[0], key[1], ...
//         The SolidSign API expects signatureFieldConfig[0]={...} per document, NOT a single
//         signatureFieldConfig=[{...}] — otherwise the field is ignored and the stamp never appears.
// [PT-BR] Envia a config de assinatura visual como campos INDEXADOS: key[0], key[1], ...
//         A API espera signatureFieldConfig[0]={...} por documento, e NÃO um único
//         signatureFieldConfig=[{...}] — senão o campo é ignorado e o carimbo não aparece.
function appendIndexedJson(form: FormData, key: string, raw?: string): void {
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { form.append(`${key}[0]`, raw); return; }
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  items.forEach((it, i) => form.append(`${key}[${i}]`, typeof it === 'string' ? it : JSON.stringify(it)));
}

export class PdfPkcs12Service {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly profile: string;
  private readonly hashAlgorithm: string;
  private readonly policyVersion: string;
  private readonly sigFieldMeasurementUnit: string;
  private readonly signatureFieldConfig: string;
  private readonly reason: string;
  private readonly location: string;
  private readonly contact: string;
  private readonly signatureImagePaths: string[];

  constructor() {
    this.baseUrl = (process.env.SOLIDSIGN_API_BASE_URL ?? '').replace(/\/$/, '');
    this.authorization = process.env.SOLIDSIGN_API_AUTHORIZATION ?? '';
    this.profile = process.env.SOLIDSIGN_SIG_PROFILE ?? 'ADRB';
    this.hashAlgorithm = process.env.SOLIDSIGN_SIG_HASH_ALGORITHM ?? 'SHA256';
    this.policyVersion = process.env.SOLIDSIGN_SIG_POLICY_VERSION ?? '';
    this.sigFieldMeasurementUnit = process.env.SOLIDSIGN_SIG_FIELD_MEASUREMENT_UNIT ?? 'PIXELS';
    this.signatureFieldConfig = process.env.SOLIDSIGN_SIG_FIELD_CONFIG ?? '';
    this.reason = process.env.SOLIDSIGN_SIG_REASON ?? '';
    this.location = process.env.SOLIDSIGN_SIG_LOCATION ?? '';
    this.contact = process.env.SOLIDSIGN_SIG_CONTACT ?? '';
    this.signatureImagePaths = (process.env.SOLIDSIGN_SIG_IMAGE_PATHS ?? '')
      .split(',').map(p => p.trim()).filter(Boolean);
  }

  async signPkcs12(pdfFiles: string[], certId: string, outputDir: string): Promise<string | null> {
    console.info(`Starting PAdES PKCS12 signing for ${pdfFiles.length} PDF(s) using certId=${certId}.`);
    const form = new FormData();
    pdfFiles.forEach((f, i) =>
      form.append(`document[${i}]`, fs.createReadStream(f), { filename: path.basename(f) }));
    this.signatureImagePaths.forEach((img, i) => {
      if (fs.existsSync(img))
        form.append(`signatureImage[${i}]`, fs.createReadStream(img), { filename: path.basename(img) });
    });
    form.append('pfxCode', certId);
    form.append('profile', this.profile);
    form.append('hashAlgorithm', this.hashAlgorithm);
    form.append('sigFieldMeasurementUnit', this.sigFieldMeasurementUnit);
    appendIndexedJson(form, 'signatureFieldConfig', this.signatureFieldConfig);
    form.append('reason', this.reason);
    form.append('location', this.location);
    form.append('contact', this.contact);
    if (this.policyVersion) form.append('policyVersion', this.policyVersion);
    // Optional — uncomment to use:
    // form.append('signatureFieldName', '...');
    // appendIndexedJson(form, 'signatureTextConfig', '[...]');
    // form.append('mdpPermissionLevel', '1');
    // form.append('passwordsForDecryption', '[...]');
    // form.append('documentInfoMetadata', '{...}');
    // appendIndexedJson(form, 'signatureQrCodeConfig', '[...]');
    try {
      const resp = await axios.post<SignResponse>(`${this.baseUrl}/solidsign/dsig/pdf/sign-pkcs12`, form, {
        headers: { Authorization: this.authorization, ...form.getHeaders() }, timeout: 120000,
      });
      const zip = await this.downloadAndZip(resp.data, pdfFiles.map(f => path.basename(f)), this.authorization);
      fs.mkdirSync(outputDir, { recursive: true });
      const out = path.join(outputDir, `signed_pdf_pkcs12_${Date.now()}.zip`);
      fs.writeFileSync(out, zip);
      console.info(`PAdES PKCS12 signing complete. Output: ${out}`);
      return out;
    } catch (err) { this.logError('PAdES PKCS12 signing', err); return null; }
  }

  async signPkcs12Form(p: FormSignParams): Promise<Buffer | null> {
    console.info(`PAdES PKCS12 form signing for ${p.documents.length} PDF(s).`);
    const form = new FormData();
    p.documents.forEach((d, i) => form.append(`document[${i}]`, d.buffer, { filename: d.originalname }));
    (p.signatureImages ?? []).forEach((img, i) => form.append(`signatureImage[${i}]`, img.buffer, { filename: img.originalname }));
    form.append('pfxCode', p.pfxCode);
    if (p.profile)                  form.append('profile', p.profile);
    if (p.hashAlgorithm)            form.append('hashAlgorithm', p.hashAlgorithm);
    if (p.policyVersion)            form.append('policyVersion', p.policyVersion);
    if (p.sigFieldMeasurementUnit)  form.append('sigFieldMeasurementUnit', p.sigFieldMeasurementUnit);
    if (p.signatureFieldConfig)     appendIndexedJson(form, 'signatureFieldConfig', p.signatureFieldConfig);
    if (p.reason)                   form.append('reason', p.reason);
    if (p.location)                 form.append('location', p.location);
    if (p.contact)                  form.append('contact', p.contact);
    if (p.signatureFieldName)       form.append('signatureFieldName', p.signatureFieldName);
    if (p.signatureTextConfig)      appendIndexedJson(form, 'signatureTextConfig', p.signatureTextConfig);
    if (p.mdpPermissionLevel)       form.append('mdpPermissionLevel', p.mdpPermissionLevel);
    if (p.passwordsForDecryption)   form.append('passwordsForDecryption', p.passwordsForDecryption);
    if (p.documentInfoMetadata)     form.append('documentInfoMetadata', p.documentInfoMetadata);
    if (p.signatureQrCodeConfig)    appendIndexedJson(form, 'signatureQrCodeConfig', p.signatureQrCodeConfig);
    try {
      const resp = await axios.post<SignResponse>(`${p.baseUrl.replace(/\/$/, '')}/solidsign/dsig/pdf/sign-pkcs12`, form, {
        headers: { Authorization: p.authorization, ...form.getHeaders() }, timeout: 120000,
      });
      return this.downloadAndZip(resp.data, p.documents.map(d => d.originalname), p.authorization);
    } catch (err) { this.logError('PAdES PKCS12 form signing', err); return null; }
  }

  private async downloadAndZip(resp: SignResponse, names: string[], auth: string): Promise<Buffer> {
    const zip = new JSZip();
    await Promise.all((resp.documents ?? []).map(async (doc, i) => {
      const link = (doc as any)._links?.self ?? doc.links?.find(l => l.rel === 'self');
      if (!link) return;
      const r = await axios.get<ArrayBuffer>(link.href, { headers: { Authorization: auth }, responseType: 'arraybuffer', timeout: 120000 });
      if (r.status === 200) zip.file(`signed_${names[i]}`, r.data);
    }));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private logError(ctx: string, err: unknown): void {
    if (axios.isAxiosError(err))
      console.error(`SolidSign API error ${err.response?.status} during ${ctx}: ${JSON.stringify(err.response?.data)}`);
    else console.error(`Unexpected error during ${ctx}: ${(err as Error).message}`);
  }
}
