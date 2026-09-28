import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { AppError, ErrorCodes } from '../domain/envelope.js';

export const SUPPORTED_GEMINI_VOICES = ['Charon', 'Aoede', 'Puck', 'Fenrir', 'Kore'];
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_VOICE_NAME = 'Charon';

// Gerador de cabeçalho WAV estático de 1 segundo de silêncio para modo mock em testes
function createMockWavBuffer() {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

export class GeminiAudioService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {import('./settingsService.js').SettingsService} settingsService
   * @param {object} [options]
   * @param {string} [options.storageDir]
   */
  constructor(db, settingsService, { storageDir = null, fetchFn = globalThis.fetch } = {}) {
    this.db = db;
    this.settingsService = settingsService;
    this.storageDir = storageDir;
    this.fetch = fetchFn;
    this._ephemeralAudioCache = new Map();
  }

  _cleanupEphemeralCache() {
    const now = Date.now();
    for (const [id, item] of this._ephemeralAudioCache.entries()) {
      if (now > item.expiresAt) {
        this._ephemeralAudioCache.delete(id);
      }
    }
    // Limite estrito de no máximo 10 áudios transitórios na memória RAM para evitar vazamentos
    if (this._ephemeralAudioCache.size > 10) {
      const oldestKeys = Array.from(this._ephemeralAudioCache.keys()).slice(0, this._ephemeralAudioCache.size - 10);
      for (const k of oldestKeys) {
        this._ephemeralAudioCache.delete(k);
      }
    }
  }

  getApiKey() {
    return this.settingsService.getRawSecret('gemini_api_key') || process.env.GEMINI_API_KEY || null;
  }

  getDefaultVoice() {
    return this.settingsService.getRawSecret('gemini_default_voice') || process.env.GEMINI_DEFAULT_VOICE || DEFAULT_VOICE_NAME;
  }

  getDefaultModel() {
    return this.settingsService.getRawSecret('gemini_default_model') || process.env.GEMINI_DEFAULT_MODEL || DEFAULT_GEMINI_MODEL;
  }

  async testKey(apiKeyOverride = null) {
    const key = apiKeyOverride || this.getApiKey();
    if (!key) {
      return {
        valid: false,
        message: 'Nenhuma chave de API do Gemini configurada.',
      };
    }

    // Se for chave mock em teste
    if (key.startsWith('test-') || key === 'dummy-key') {
      return {
        valid: true,
        message: 'Chave de teste aceita em modo sandbox.',
      };
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      const res = await this.fetch(url);
      if (!res.ok) {
        const errorText = await res.text();
        return {
          valid: false,
          httpStatus: res.status,
          message: `Chave inválida ou recusada pelo Google (${res.status}): ${errorText}`,
        };
      }

      const data = await res.json();
      return {
        valid: true,
        modelsCount: data?.models?.length || 0,
        message: 'Chave do Gemini válida e operacional com sucesso!',
      };
    } catch (err) {
      logger.error('Erro ao testar chave do Gemini:', err);
      return {
        valid: false,
        message: `Falha de rede ao conectar com Google AI Studio: ${err.message}`,
      };
    }
  }

  /**
   * Gera áudio via Gemini Text-to-Speech (TTS) em memória sem retenção em disco ou banco.
   */
  async generateAudio({
    text,
    voiceName = null,
    model = null,
    promptInstruction = null,
    spaceId = null,
    mock = false,
  }) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Texto para geração de áudio não pode ser vazio.', 400);
    }

    const selectedVoice = voiceName || this.getDefaultVoice();
    const selectedModel = model || this.getDefaultModel();
    const apiKey = this.getApiKey();

    // Modo Mock para testes sem conexão de rede ou sem chave real
    if (mock || !apiKey || apiKey.startsWith('test-') || apiKey === 'dummy-key') {
      if (!apiKey && !mock) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          'Chave de API do Gemini não configurada. Informe a chave nas Configurações do sistema ou no .env.',
          500,
        );
      }

      const id = randomUUID();
      const mockWav = createMockWavBuffer();
      const fileName = `audio-${id}.wav`;

      this._cleanupEphemeralCache();
      this._ephemeralAudioCache.set(id, {
        buffer: mockWav,
        mimeType: 'audio/wav',
        fileName,
        expiresAt: Date.now() + 60_000,
      });

      return {
        audio_id: id,
        mock: true,
        voice_name: selectedVoice,
        model: selectedModel,
        mime_type: 'audio/wav',
        byte_size: mockWav.length,
        audio_base64: mockWav.toString('base64'),
        local_url: `/api/v1/media/audio/${id}`,
        text_length: text.length,
      };
    }

    // Chamada oficial à API do Gemini
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

      const contentPrompt = promptInstruction
        ? `${promptInstruction}\n\nTexto a ser lido com naturalidade e clareza:\n${text.trim()}`
        : text.trim();

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: contentPrompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedVoice,
              },
            },
          },
        },
      };

      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new AppError(ErrorCodes.INTERNAL_ERROR, `Google Gemini retornou erro (${res.status}): ${errorText}`, 502);
      }

      const data = await res.json();
      const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

      if (!inlineData || !inlineData.data) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Google Gemini não retornou dados de áudio na resposta.', 502);
      }

      const audioBuffer = Buffer.from(inlineData.data, 'base64');
      const mimeType = inlineData.mimeType || 'audio/wav';
      const ext = mimeType.includes('mp3') ? 'mp3' : 'wav';

      const id = randomUUID();
      const fileName = `audio-${id}.${ext}`;

      this._cleanupEphemeralCache();
      this._ephemeralAudioCache.set(id, {
        buffer: audioBuffer,
        mimeType,
        fileName,
        expiresAt: Date.now() + 60_000,
      });

      logger.info('Áudio Gemini gerado com sucesso (efêmero em memória)', { audioId: id, voice: selectedVoice, size: audioBuffer.length });

      return {
        audio_id: id,
        voice_name: selectedVoice,
        model: selectedModel,
        mime_type: mimeType,
        byte_size: audioBuffer.length,
        audio_base64: inlineData.data,
        local_url: `/api/v1/media/audio/${id}`,
        text_length: text.length,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Falha ao gerar áudio com Gemini: ${err.message}`, 502);
    }
  }

  async getAudioFile(audioId) {
    if (!audioId || typeof audioId !== 'string') {
      throw new AppError(ErrorCodes.NOT_FOUND, 'ID de áudio não fornecido.', 404);
    }
    const sanitizedId = audioId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitizedId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'ID de áudio inválido.', 400);
    }

    this._cleanupEphemeralCache();
    const item = this._ephemeralAudioCache.get(sanitizedId);
    if (!item || Date.now() > item.expiresAt) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Arquivo de áudio não encontrado ou já expirado.', 404);
    }

    return {
      buffer: item.buffer,
      mimeType: item.mimeType,
      fileName: item.fileName,
    };
  }
}
