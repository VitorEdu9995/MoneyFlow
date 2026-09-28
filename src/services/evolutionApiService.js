import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { AppError, ErrorCodes } from '../domain/envelope.js';

export function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  // Se for celular brasileiro sem 55 (ex: 11999999999 ou 1188888888), adiciona 55
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

export class EvolutionApiService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {import('./settingsService.js').SettingsService} settingsService
   * @param {object} [options]
   */
  constructor(db, settingsService, { fetchFn = globalThis.fetch } = {}) {
    this.db = db;
    this.settingsService = settingsService;
    this.fetch = fetchFn;
  }

  getConfig(instanceOverride = null) {
    const rawUrl = this.settingsService.getRawSecret('evolution_api_url') || process.env.EVOLUTION_API_URL || '';
    const apiKey = this.settingsService.getRawSecret('evolution_api_key') || process.env.EVOLUTION_API_KEY || '';
    const instance = instanceOverride || this.settingsService.getRawSecret('evolution_instance_name') || process.env.EVOLUTION_INSTANCE_NAME || 'moneyflow';

    const baseUrl = rawUrl.replace(/\/+$/, '');
    return {
      baseUrl,
      apiKey,
      instance,
      configured: Boolean(baseUrl && apiKey && instance),
    };
  }

  _recordDispatch(_params) {
    // Zero-storage: áudios e mensagens do WhatsApp não são armazenados no servidor
    // para evitar acúmulo desnecessário de dados e preservar a memória da VPS.
    return;
  }

  async testConnection({ instanceName = null } = {}) {
    const config = this.getConfig(instanceName);
    if (!config.configured) {
      return {
        connected: false,
        status: 'unconfigured',
        message: 'Evolution API não configurada. Defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME.',
      };
    }

    try {
      const url = `${config.baseUrl}/instance/connectionState/${config.instance}`;
      const res = await this.fetch(url, {
        method: 'GET',
        headers: {
          'apikey': config.apiKey,
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          connected: false,
          status: 'http_error',
          httpStatus: res.status,
          message: `Erro na Evolution API: ${errorText || res.statusText}`,
        };
      }

      const data = await res.json();
      const state = data?.instance?.state || data?.state || 'open';
      const isConnected = state === 'open' || state === 'connected';

      return {
        connected: isConnected,
        state,
        instance: config.instance,
        message: isConnected ? 'WhatsApp conectado e pronto para envio.' : `Instância em estado: ${state}`,
      };
    } catch (err) {
      logger.error('Erro ao testar conexão com Evolution API:', err);
      return {
        connected: false,
        status: 'network_error',
        message: `Falha ao alcançar Evolution API: ${err.message}`,
      };
    }
  }

  /**
   * Envia mensagem de texto via WhatsApp (Evolution API).
   */
  async sendTextMessage({ recipient, text, instanceName = null, spaceId = null, mock = false }) {
    const sanitizedNumber = sanitizePhoneNumber(recipient);
    if (!sanitizedNumber) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Número de telefone do destinatário inválido.', 400);
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conteúdo do texto não pode ser vazio.', 400);
    }

    const config = this.getConfig(instanceName);

    // Suporte a modo mock (para testes unitários ou ambientes sem WhatsApp real)
    if (mock || !config.configured) {
      if (!config.configured && !mock) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          'Evolution API não configurada no servidor. Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no .env ou nas Configurações.',
          500,
        );
      }

      const mockMsgId = `mock-msg-${randomUUID()}`;
      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: 'text',
        payloadSummary: text,
        status: 'sent_mock',
        externalMessageId: mockMsgId,
      });

      return {
        success: true,
        mock: true,
        messageId: mockMsgId,
        recipient: sanitizedNumber,
        status: 'sent',
      };
    }

    try {
      const url = `${config.baseUrl}/message/sendText/${config.instance}`;
      const payload = {
        number: sanitizedNumber,
        text: text.trim(),
        textMessage: {
          text: text.trim(),
        },
      };

      const res = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        this._recordDispatch({
          spaceId,
          recipient: sanitizedNumber,
          messageType: 'text',
          payloadSummary: text,
          status: 'failed',
          errorMessage: errorText,
        });
        throw new AppError(ErrorCodes.INTERNAL_ERROR, `Evolution API retornou erro (${res.status}): ${errorText}`, 502);
      }

      const data = await res.json();
      const messageId = data?.key?.id || data?.messageId || randomUUID();

      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: 'text',
        payloadSummary: text,
        status: 'sent',
        externalMessageId: messageId,
      });

      logger.info('Mensagem WhatsApp de texto enviada com sucesso', { recipient: sanitizedNumber, messageId });
      return {
        success: true,
        messageId,
        recipient: sanitizedNumber,
        status: 'sent',
        data,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: 'text',
        payloadSummary: text,
        status: 'failed',
        errorMessage: err.message,
      });
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Falha de rede ao enviar WhatsApp: ${err.message}`, 502);
    }
  }

  /**
   * Envia áudio / mensagem de voz (PTT) via WhatsApp (Evolution API).
   */
  async sendAudioMessage({ recipient, audioBase64 = null, audioUrl = null, instanceName = null, spaceId = null, mock = false }) {
    const sanitizedNumber = sanitizePhoneNumber(recipient);
    if (!sanitizedNumber) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Número de telefone do destinatário inválido.', 400);
    }
    if (!audioBase64 && !audioUrl) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'É obrigatório informar audio_base64 ou audio_url.', 400);
    }

    const config = this.getConfig(instanceName);

    if (mock || !config.configured) {
      if (!config.configured && !mock) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          'Evolution API não configurada no servidor. Configure EVOLUTION_API_URL e EVOLUTION_API_KEY.',
          500,
        );
      }

      const mockMsgId = `mock-audio-${randomUUID()}`;
      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: 'audio',
        payloadSummary: audioUrl || `base64 (${audioBase64?.length || 0} chars)`,
        status: 'sent_mock',
        externalMessageId: mockMsgId,
      });

      return {
        success: true,
        mock: true,
        messageId: mockMsgId,
        recipient: sanitizedNumber,
        status: 'sent',
      };
    }

    try {
      const url = `${config.baseUrl}/message/sendWhatsAppAudio/${config.instance}`;
      
      // Formata áudio: se for base64 sem prefixo data:, formata para áudio mp3/wav
      let audioPayload = audioUrl || audioBase64;
      if (audioBase64 && !audioBase64.startsWith('data:') && !audioBase64.startsWith('http')) {
        audioPayload = `data:audio/mp3;base64,${audioBase64}`;
      }

      const payload = {
        number: sanitizedNumber,
        audio: audioPayload,
        encoding: true,
      };

      const res = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        this._recordDispatch({
          spaceId,
          recipient: sanitizedNumber,
          messageType: 'audio',
          payloadSummary: audioUrl || 'base64 audio',
          status: 'failed',
          errorMessage: errorText,
        });
        throw new AppError(ErrorCodes.INTERNAL_ERROR, `Evolution API retornou erro no áudio (${res.status}): ${errorText}`, 502);
      }

      const data = await res.json();
      const messageId = data?.key?.id || data?.messageId || randomUUID();

      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: 'audio',
        payloadSummary: audioUrl || 'base64 audio',
        status: 'sent',
        externalMessageId: messageId,
      });

      logger.info('Áudio WhatsApp enviado com sucesso', { recipient: sanitizedNumber, messageId });
      return {
        success: true,
        messageId,
        recipient: sanitizedNumber,
        status: 'sent',
        data,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Falha ao enviar áudio no WhatsApp: ${err.message}`, 502);
    }
  }

  /**
   * Envia imagem, gráfico ou documento via WhatsApp (Evolution API).
   */
  async sendMediaMessage({ recipient, mediaBase64 = null, mediaUrl = null, mediaType = 'image', caption = '', fileName = 'documento', mimetype = 'image/png', instanceName = null, spaceId = null, mock = false }) {
    const sanitizedNumber = sanitizePhoneNumber(recipient);
    if (!sanitizedNumber) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Número de telefone do destinatário inválido.', 400);
    }
    if (!mediaBase64 && !mediaUrl) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'É obrigatório informar media_base64 ou media_url.', 400);
    }

    const config = this.getConfig(instanceName);

    if (mock || !config.configured) {
      if (!config.configured && !mock) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          'Evolution API não configurada no servidor. Configure EVOLUTION_API_URL e EVOLUTION_API_KEY.',
          500,
        );
      }

      const mockMsgId = `mock-media-${randomUUID()}`;
      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: mediaType || 'image',
        payloadSummary: caption || mediaUrl || 'media content',
        status: 'sent_mock',
        externalMessageId: mockMsgId,
      });

      return {
        success: true,
        mock: true,
        messageId: mockMsgId,
        recipient: sanitizedNumber,
        status: 'sent',
      };
    }

    try {
      const url = `${config.baseUrl}/message/sendMedia/${config.instance}`;
      let mediaPayload = mediaUrl || mediaBase64;
      if (mediaBase64 && !mediaBase64.startsWith('data:') && !mediaBase64.startsWith('http')) {
        mediaPayload = `data:${mimetype};base64,${mediaBase64}`;
      }

      const payload = {
        number: sanitizedNumber,
        media: mediaPayload,
        mediatype: mediaType,
        mimetype,
        caption: caption || '',
        fileName,
      };

      const res = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new AppError(ErrorCodes.INTERNAL_ERROR, `Evolution API retornou erro na mídia (${res.status}): ${errorText}`, 502);
      }

      const data = await res.json();
      const messageId = data?.key?.id || data?.messageId || randomUUID();

      this._recordDispatch({
        spaceId,
        recipient: sanitizedNumber,
        messageType: mediaType,
        payloadSummary: caption || fileName,
        status: 'sent',
        externalMessageId: messageId,
      });

      logger.info('Mídia WhatsApp enviada com sucesso', { recipient: sanitizedNumber, messageId });
      return {
        success: true,
        messageId,
        recipient: sanitizedNumber,
        status: 'sent',
        data,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Falha ao enviar mídia no WhatsApp: ${err.message}`, 502);
    }
  }
}
