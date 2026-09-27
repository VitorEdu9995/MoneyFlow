import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError, ErrorCodes } from '../domain/envelope.js';

const MAGIC_HEADER = Buffer.from('MFBK', 'ascii');
const HEADER_MIN_SIZE = 4 + 1 + 1 + 16 + 1 + 12 + 1 + 16 + 32; // 84 bytes

async function readDirectoryRecursive(baseDir, currentSub = '') {
  const fullPath = path.join(baseDir, currentSub);
  let entries;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const rel = path.join(currentSub, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      const nested = await readDirectoryRecursive(baseDir, rel);
      files.push(...nested);
    } else if (entry.isFile()) {
      const filePath = path.join(baseDir, rel);
      const content = await fs.readFile(filePath);
      const sha256 = createHash('sha256').update(content).digest('hex');
      files.push({
        relativePath: rel,
        contentBase64: content.toString('base64'),
        sha256,
      });
    }
  }
  return files;
}

export class BackupRestoreService {
  /**
   * Gera um backup criptografado AES-256-GCM contendo o banco de dados e arquivos de anexos.
   */
  static async createEncryptedBackup({ dbPath, attachmentsDir, backupPath, secretKey }) {
    if (!secretKey || typeof secretKey !== 'string' || secretKey.length < 16) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'A chave secreta de backup deve ter no mínimo 16 caracteres.',
        400,
      );
    }

    let dbBuffer = Buffer.alloc(0);
    if (dbPath) {
      try {
        dbBuffer = await fs.readFile(dbPath);
      } catch (err) {
        throw new AppError(ErrorCodes.NOT_FOUND, `Arquivo do banco de dados não encontrado: ${dbPath}`, 404);
      }
    }

    const attachments = attachmentsDir ? await readDirectoryRecursive(attachmentsDir) : [];

    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      dbBase64: dbBuffer.toString('base64'),
      attachments,
    };

    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const checksumSha256 = createHash('sha256').update(payloadBuffer).digest();

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const derivedKey = scryptSync(secretKey, salt, 32);

    const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
    const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const header = Buffer.concat([
      MAGIC_HEADER,
      Buffer.from([1]), // version
      Buffer.from([salt.length]),
      salt,
      Buffer.from([iv.length]),
      iv,
      Buffer.from([authTag.length]),
      authTag,
      checksumSha256,
    ]);

    const backupBuffer = Buffer.concat([header, ciphertext]);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, backupBuffer);

    return {
      backupPath,
      checksumSha256: checksumSha256.toString('hex'),
      filesCount: attachments.length + (dbBuffer.length > 0 ? 1 : 0),
      sizeBytes: backupBuffer.length,
      createdAt: payload.createdAt,
    };
  }

  /**
   * Restaura um backup criptografado com validação estrita de integridade e SQLite PRAGMA check.
   */
  static async restoreEncryptedBackup({ backupPath, targetDbPath, targetAttachmentsDir, secretKey }) {
    if (!secretKey || typeof secretKey !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Chave secreta de restauração é obrigatória.', 400);
    }

    let backupBuffer;
    try {
      backupBuffer = await fs.readFile(backupPath);
    } catch {
      throw new AppError(ErrorCodes.NOT_FOUND, `Arquivo de backup não encontrado: ${backupPath}`, 404);
    }

    if (backupBuffer.length < HEADER_MIN_SIZE) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Backup corrompido: arquivo menor que o cabeçalho mínimo.', 400);
    }

    const magic = backupBuffer.subarray(0, 4);
    if (!magic.equals(MAGIC_HEADER)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Formato de backup inválido: cabeçalho mágico divergente.', 400);
    }

    let offset = 4;
    const version = backupBuffer.readUInt8(offset);
    offset += 1;
    if (version !== 1) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Versão de backup não suportada: ${version}`, 400);
    }

    const saltLen = backupBuffer.readUInt8(offset);
    offset += 1;
    const salt = backupBuffer.subarray(offset, offset + saltLen);
    offset += saltLen;

    const ivLen = backupBuffer.readUInt8(offset);
    offset += 1;
    const iv = backupBuffer.subarray(offset, offset + ivLen);
    offset += ivLen;

    const authTagLen = backupBuffer.readUInt8(offset);
    offset += 1;
    const authTag = backupBuffer.subarray(offset, offset + authTagLen);
    offset += authTagLen;

    const expectedSha256 = backupBuffer.subarray(offset, offset + 32);
    offset += 32;

    const ciphertext = backupBuffer.subarray(offset);
    if (ciphertext.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Backup corrompido: conteúdo criptografado ausente.', 400);
    }

    const derivedKey = scryptSync(secretKey, salt, 32);

    let decryptedBuffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAuthTag(authTag);
      decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Falha de autenticação do backup: chave incorreta ou dados corrompidos/truncados.',
        400,
      );
    }

    const actualSha256 = createHash('sha256').update(decryptedBuffer).digest();
    if (!actualSha256.equals(expectedSha256)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Checksum de integridade do backup divergente: payload adulterado.',
        400,
      );
    }

    let payload;
    try {
      payload = JSON.parse(decryptedBuffer.toString('utf8'));
    } catch {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Dados do backup não representam JSON válido.', 400);
    }

    // Restaura banco de dados SQLite
    if (targetDbPath && payload.dbBase64) {
      await fs.mkdir(path.dirname(targetDbPath), { recursive: true });
      const dbContent = Buffer.from(payload.dbBase64, 'base64');
      await fs.writeFile(targetDbPath, dbContent);

      // Validação estrita de integridade SQLite
      try {
        const db = new DatabaseSync(targetDbPath);
        const check = db.prepare('PRAGMA integrity_check;').get();
        db.close();
        const checkResult = check ? Object.values(check)[0] : null;
        if (checkResult !== 'ok') {
          await fs.rm(targetDbPath, { force: true });
          throw new AppError(ErrorCodes.INTERNAL_ERROR, `Integridade do banco de dados restaurado falhou: ${checkResult}`, 500);
        }
      } catch (err) {
        await fs.rm(targetDbPath, { force: true });
        if (err instanceof AppError) throw err;
        throw new AppError(ErrorCodes.INTERNAL_ERROR, `Falha ao validar integridade do banco SQLite: ${err.message}`, 500);
      }
    }

    // Restaura anexos
    let filesRestored = 0;
    if (targetAttachmentsDir && Array.isArray(payload.attachments)) {
      await fs.mkdir(targetAttachmentsDir, { recursive: true });
      for (const item of payload.attachments) {
        // Previne path traversal em restauração de anexos
        const normalizedRel = path.normalize(item.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const targetPath = path.join(targetAttachmentsDir, normalizedRel);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = Buffer.from(item.contentBase64, 'base64');
        await fs.writeFile(targetPath, content);
        filesRestored += 1;
      }
    }

    return {
      restored: true,
      targetDbPath,
      targetAttachmentsDir,
      filesRestored,
      restoredAt: new Date().toISOString(),
    };
  }
}
