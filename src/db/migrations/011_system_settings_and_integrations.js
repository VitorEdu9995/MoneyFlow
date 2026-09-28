/**
 * Migration 011 — Configurações globais de sistema, integração com Evolution API e Gemini TTS (Áudio).
 */

export function up(db) {
  db.exec(`
  -- 1. Configurações de Sistema com suporte a criptografia AES-256-GCM
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    iv TEXT,
    auth_tag TEXT,
    is_secret INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 2. Histórico de áudios gerados pelo Gemini TTS para os agentes de IA
  CREATE TABLE IF NOT EXISTS audio_generations (
    id TEXT PRIMARY KEY,
    space_id TEXT,
    text_prompt TEXT NOT NULL,
    voice_name TEXT NOT NULL DEFAULT 'Charon',
    model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    mime_type TEXT NOT NULL DEFAULT 'audio/wav',
    storage_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audio_generations_space ON audio_generations(space_id);

  -- 3. Histórico e auditoria de mensagens disparadas via Evolution API (WhatsApp)
  CREATE TABLE IF NOT EXISTS message_dispatches (
    id TEXT PRIMARY KEY,
    space_id TEXT,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    recipient TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    payload_summary TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    external_message_id TEXT,
    error_message TEXT,
    dispatched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_message_dispatches_space ON message_dispatches(space_id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatches_recipient ON message_dispatches(recipient);
  `);
}

export const down = `
  DROP TABLE IF EXISTS message_dispatches;
  DROP TABLE IF EXISTS audio_generations;
  DROP TABLE IF EXISTS system_settings;
`;
