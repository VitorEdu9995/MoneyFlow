import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { logger } from '../utils/logger.js';

const DEFAULT_SECRET_SALT = 'moneyflow-system-settings-salt-2026';
const ALGORITHM = 'aes-256-gcm';

export function maskSecret(val) {
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

export class SettingsService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {object} [options]
   * @param {string} [options.appSecret]
   */
  constructor(db, { appSecret = process.env.APP_SECRET || DEFAULT_SECRET_SALT } = {}) {
    this.db = db;
    this.appSecret = appSecret;
    // Deriva chave estável de 32 bytes para AES-256
    this.derivedKey = scryptSync(this.appSecret, DEFAULT_SECRET_SALT, 32);
  }

  _encrypt(plainText) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.derivedKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  _decrypt(encryptedHex, ivHex, authTagHex) {
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = createDecipheriv(ALGORITHM, this.derivedKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      logger.error('Falha ao descriptografar configuração de sistema:', err);
      return null;
    }
  }

  /**
   * Obtém o valor em texto plano de um segredo para uso interno pelo backend/agentes.
   * Consulta primeiro a tabela system_settings (criptografada), com fallback para variáveis de ambiente (.env).
   * @param {string} key
   * @returns {string|null}
   */
  getRawSecret(key) {
    const row = this.db.prepare('SELECT * FROM system_settings WHERE key = ?').get(key);
    if (row) {
      if (row.is_secret && row.iv && row.auth_tag) {
        const decrypted = this._decrypt(row.value, row.iv, row.auth_tag);
        if (decrypted) return decrypted;
      } else {
        return row.value;
      }
    }

    // Fallback para variáveis de ambiente
    const envKey = key.toUpperCase();
    if (process.env[envKey]) {
      return process.env[envKey];
    }

    return null;
  }

  /**
   * Obtém uma configuração formatada com segurança (valores sensíveis são mascarados).
   * @param {string} key
   */
  getSetting(key) {
    const row = this.db.prepare('SELECT * FROM system_settings WHERE key = ?').get(key);
    const envKey = key.toUpperCase();
    const envVal = process.env[envKey];

    if (!row && !envVal) {
      return {
        key,
        configured: false,
        value: '',
        masked: '',
        isSecret: key.includes('key') || key.includes('secret') || key.includes('token'),
        source: 'none',
      };
    }

    const isSecret = row ? Boolean(row.is_secret) : (key.includes('key') || key.includes('secret') || key.includes('token'));
    const source = row ? 'database' : 'environment';
    const rawVal = this.getRawSecret(key) || '';

    return {
      key,
      configured: Boolean(rawVal),
      value: isSecret ? '' : rawVal,
      masked: isSecret ? maskSecret(rawVal) : rawVal,
      isSecret,
      source,
      updatedAt: row?.updated_at || null,
      description: row?.description || '',
    };
  }

  /**
   * Salva ou atualiza uma configuração. Se for segredo, aplica criptografia AES-256-GCM.
   */
  setSetting(key, value, { isSecret = false, description = '' } = {}) {
    if (typeof value !== 'string') {
      value = String(value || '');
    }

    const trimmed = value.trim();

    // Se for segredo e vier em formato mascarado ou vazio, não sobrescreve
    if (isSecret && (trimmed.includes('••••') || !trimmed)) {
      return this.getSetting(key);
    }

    const now = new Date().toISOString();

    if (isSecret) {
      const { encrypted, iv, authTag } = this._encrypt(trimmed);
      this.db.prepare(`
        INSERT INTO system_settings (key, value, iv, auth_tag, is_secret, description, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          iv = excluded.iv,
          auth_tag = excluded.auth_tag,
          is_secret = 1,
          description = COALESCE(excluded.description, system_settings.description),
          updated_at = excluded.updated_at
      `).run(key, encrypted, iv, authTag, description, now);
    } else {
      this.db.prepare(`
        INSERT INTO system_settings (key, value, iv, auth_tag, is_secret, description, updated_at)
        VALUES (?, ?, NULL, NULL, 0, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          iv = NULL,
          auth_tag = NULL,
          is_secret = 0,
          description = COALESCE(excluded.description, system_settings.description),
          updated_at = excluded.updated_at
      `).run(key, trimmed, description, now);
    }

    logger.info(`Configuração de sistema '${key}' atualizada com sucesso`, { isSecret, key });
    return this.getSetting(key);
  }

  /**
   * Retorna um resumo seguro de todas as integrações configuradas no sistema.
   */
  getAllIntegrationSettings() {
    const keys = [
      'evolution_api_url',
      'evolution_api_key',
      'evolution_instance_name',
      'gemini_api_key',
      'gemini_default_voice',
      'gemini_default_model',
    ];

    const result = {};
    for (const k of keys) {
      result[k] = this.getSetting(k);
    }

    return {
      evolution: {
        configured: Boolean(result.evolution_api_url.configured && result.evolution_instance_name.configured),
        apiUrl: result.evolution_api_url.value || process.env.EVOLUTION_API_URL || '',
        apiKeyMasked: result.evolution_api_key.masked,
        instanceName: result.evolution_instance_name.value || process.env.EVOLUTION_INSTANCE_NAME || '',
      },
      gemini: {
        configured: Boolean(result.gemini_api_key.configured),
        apiKeyMasked: result.gemini_api_key.masked,
        defaultVoice: result.gemini_default_voice.value || process.env.GEMINI_DEFAULT_VOICE || 'Charon',
        defaultModel: result.gemini_default_model.value || process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
      },
      settings: result,
    };
  }
}
