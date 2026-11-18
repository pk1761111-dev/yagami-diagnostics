import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { bad, notFound, sha256 } from '../lib/util.js';

export const filesRouter = Router();

if (config.fileStorage === 'disk') fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

/** Detect type from the file's actual bytes – the browser-supplied MIME type is not trusted. */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

filesRouter.post('/', requireAuth('owner', 'staff3'), (req, res, next) => {
  upload.single('file')(req, res, async (err: any) => {
    try {
      if (err?.code === 'LIMIT_FILE_SIZE') throw bad(`File too large. Maximum ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
      if (err) throw bad('Upload failed');
      const f = req.file;
      if (!f || !f.buffer.length) throw bad('No file received');
      const t = sniff(f.buffer);
      if (!t) throw bad('Only JPG, PNG, WEBP images or PDF files are allowed');
      let storage: string | null = null;
      if (config.fileStorage === 'disk') {
        storage = `${crypto.randomUUID()}.${t.ext}`;
        fs.writeFileSync(path.join(config.uploadDir, storage), f.buffer, { flag: 'wx', mode: 0o640 });
      }
      const safeName = f.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `proof.${t.ext}`;
      const row = await one(
        `INSERT INTO files(original_name, mime, size_bytes, sha256, storage_name, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, original_name, mime, size_bytes, created_at`,
        [safeName, t.mime, f.size, sha256(f.buffer), storage, storage ? null : f.buffer, req.user!.id],
      );
      await audit(null, { actor: req.user!.id, action: 'file.upload', entity: 'file', id: row.id, after: row, ip: req.ip });
      res.status(201).json({ file: row });
    } catch (e) {
      next(e);
    }
  });
});

filesRouter.get('/:id', requireAuth('owner', 'staff3'), async (req, res) => {
  const f = await one(`SELECT * FROM files WHERE id=$1`, [req.params.id]);
  if (!f) throw notFound();
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${f.original_name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (f.data) return res.end(f.data);
  fs.createReadStream(path.join(config.uploadDir, f.storage_name)).on('error', () => res.status(404).end()).pipe(res);
});
