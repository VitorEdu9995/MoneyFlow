import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { SettingsService, maskSecret } from '../../src/services/settingsService.js';
import { EvolutionApiService, sanitizePhoneNumber } from '../../src/services/evolutionApiService.js';
import { GeminiAudioService } from '../../src/services/geminiAudioService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { Roles } from '../../src/domain/authorization.js';

function setupTestEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);

  const service = new SpaceIsolationService(db);
  const user = service.createUser({ name: 'Vitor Maestro', email: 'vitor@teste.local' });
  const personalSpace = service.createSpace({ name: 'Pessoal', ownerUserId: user.id });

  const settingsService = new SettingsService(db, { appSecret: 'test-encryption-key-32-chars-long!' });
  const evolutionService = new EvolutionApiService(db, settingsService);
  const geminiAudioService = new GeminiAudioService(db, settingsService, {
    storageDir: '.data/test-audio',
  });

  const gateway = new McpGateway({
    service,
    settingsService,
    evolutionService,
    geminiAudioService,
  });

  const authContext = {
    userId: user.id,
    spaceId: personalSpace.id,
    role: Roles.OWNER,
    membership: { status: 'active', role: Roles.OWNER },
  };

  return { db, service, user, personalSpace, settingsService, evolutionService, geminiAudioService, gateway, authContext };
}

test('SettingsService: criptografa com AES-256-GCM e mascara segredos', () => {
  const { settingsService, db } = setupTestEnvironment();

  // 1. Mascaramento
  assert.equal(maskSecret('AIzaSyAbcd12345678WXYZ'), 'AIza••••••••WXYZ');
  assert.equal(maskSecret('curto'), '••••••••');

  // 2. Salva segredo (Gemini API Key)
  settingsService.setSetting('gemini_api_key', 'AIzaSySecretKey1234567890', {
    isSecret: true,
    description: 'Google AI Studio Key',
  });

  // 3. Verifica no banco que está criptografado (não contém texto plano)
  const row = db.prepare("SELECT * FROM system_settings WHERE key = 'gemini_api_key'").get();
  assert.ok(row);
  assert.notEqual(row.value, 'AIzaSySecretKey1234567890');
  assert.ok(row.iv);
  assert.ok(row.auth_tag);
  assert.equal(row.is_secret, 1);

  // 4. Descriptografa com segurança para o backend
  const decrypted = settingsService.getRawSecret('gemini_api_key');
  assert.equal(decrypted, 'AIzaSySecretKey1234567890');

  // 5. Exibe mascarado na leitura segura
  const setting = settingsService.getSetting('gemini_api_key');
  assert.equal(setting.configured, true);
  assert.equal(setting.isSecret, true);
  assert.equal(setting.masked, 'AIza••••••••7890');
  assert.equal(setting.value, ''); // Nunca retorna valor cru

  // 6. Tentativa de sobrescrever com máscara é ignorada
  settingsService.setSetting('gemini_api_key', 'AIza••••••••7890', { isSecret: true });
  assert.equal(settingsService.getRawSecret('gemini_api_key'), 'AIzaSySecretKey1234567890');
});

test('EvolutionApiService: sanitiza telefone e despacha mensagens com auditoria', async () => {
  const { evolutionService, db, authContext } = setupTestEnvironment();

  // 1. Sanitização de números de telefone
  assert.equal(sanitizePhoneNumber('+55 (11) 98765-4321'), '5511987654321');
  assert.equal(sanitizePhoneNumber('11987654321'), '5511987654321');
  assert.equal(sanitizePhoneNumber('5511987654321'), '5511987654321');

  // 2. Envio de texto (modo mock)
  const textRes = await evolutionService.sendTextMessage({
    recipient: '+55 11 98888-7777',
    text: 'Olá Vitor! Seu resumo financeiro de hoje está pronto.',
    spaceId: authContext.spaceId,
    mock: true,
  });
  assert.equal(textRes.success, true);
  assert.equal(textRes.recipient, '5511988887777');
  assert.equal(textRes.status, 'sent');

  // 3. Auditoria registrada na tabela message_dispatches
  const dispatchRow = db.prepare("SELECT * FROM message_dispatches WHERE recipient = '5511988887777'").get();
  assert.ok(dispatchRow);
  assert.equal(dispatchRow.channel, 'whatsapp');
  assert.equal(dispatchRow.message_type, 'text');
  assert.ok(dispatchRow.payload_summary.includes('resumo financeiro'));

  // 4. Envio de áudio (modo mock)
  const audioRes = await evolutionService.sendAudioMessage({
    recipient: '5511988887777',
    audioBase64: 'UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    spaceId: authContext.spaceId,
    mock: true,
  });
  assert.equal(audioRes.success, true);

  // 5. Envio de mídia/gráfico (modo mock)
  const mediaRes = await evolutionService.sendMediaMessage({
    recipient: '5511988887777',
    mediaBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    mediaType: 'image',
    caption: 'Gráfico de Despesas da Semana',
    spaceId: authContext.spaceId,
    mock: true,
  });
  assert.equal(mediaRes.success, true);
});

test('GeminiAudioService: sintetiza áudio TTS e persiste arquivo WAV', async () => {
  const { geminiAudioService, db } = setupTestEnvironment();

  // Gera áudio falado com voz Charon
  const audioRes = await geminiAudioService.generateAudio({
    text: 'Boa noite Vitor. Hoje você gastou R$ 142,50 no supermercado.',
    voiceName: 'Charon',
    model: 'gemini-2.5-flash',
    mock: true,
  });

  assert.ok(audioRes.audio_id);
  assert.equal(audioRes.voice_name, 'Charon');
  assert.equal(audioRes.mime_type, 'audio/wav');
  assert.ok(audioRes.byte_size > 0);
  assert.ok(audioRes.audio_base64.length > 0);
  assert.ok(audioRes.local_url.startsWith('/api/v1/media/audio/'));

  // Verifica persistência na tabela audio_generations
  const audioRow = db.prepare('SELECT * FROM audio_generations WHERE id = ?').get(audioRes.audio_id);
  assert.ok(audioRow);
  assert.equal(audioRow.voice_name, 'Charon');
  assert.equal(audioRow.mime_type, 'audio/wav');

  // Recupera o arquivo para streaming
  const file = await geminiAudioService.getAudioFile(audioRes.audio_id);
  assert.equal(file.mimeType, 'audio/wav');
  assert.ok(file.buffer.length > 0);
});

test('McpGateway: ferramentas de integração catalogadas e executáveis', async () => {
  const { gateway, authContext } = setupTestEnvironment();

  const toolNames = gateway.getToolNames();
  assert.ok(toolNames.includes('whatsapp_send_message'));
  assert.ok(toolNames.includes('gemini_generate_audio'));
  assert.ok(toolNames.includes('get_integration_settings'));
  assert.ok(toolNames.includes('update_integration_settings'));
  assert.ok(toolNames.includes('test_whatsapp_connection'));
  assert.ok(toolNames.includes('test_gemini_connection'));

  // 1. Atualizar e consultar configurações via MCP
  const updateRes = await gateway.executeTool('update_integration_settings', {
    gemini_api_key: 'AIzaSySecretMCPKey123',
    gemini_default_voice: 'Charon',
    evolution_api_url: 'https://evolution.minhavps.com',
    evolution_instance_name: 'moneyflow-prod',
  }, authContext);

  assert.equal(updateRes.status, 'ok');
  assert.equal(updateRes.data.gemini.configured, true);
  assert.equal(updateRes.data.gemini.defaultVoice, 'Charon');
  assert.ok(updateRes.data.gemini.apiKeyMasked.includes('••••'));

  // 2. Testar conectividade da chave Gemini
  const testGeminiRes = await gateway.executeTool('test_gemini_connection', {
    api_key: 'test-sandbox-key',
  }, authContext);
  assert.equal(testGeminiRes.status, 'ok');
  assert.equal(testGeminiRes.data.valid, true);
});

test('Simulação Completa do Fluxo do Agente de IA (fluxograma_agendamento_financeiro.mmd)', async () => {
  const { gateway, authContext, personalSpace } = setupTestEnvironment();

  // Configura credenciais para simulação
  await gateway.executeTool('update_integration_settings', {
    gemini_api_key: 'AIzaSyTestKey12345678',
    evolution_api_url: 'https://evolution.local',
    evolution_instance_name: 'agente-financeiro',
  }, authContext);

  // Cadastra contas e contas a pagar
  const accRes = await gateway.executeTool('create_account', {
    name: 'Conta Corrente',
    account_type: 'checking',
    opening_balance: 5000,
  }, authContext);
  const accountId = accRes.data.id;

  const catRes = await gateway.executeTool('create_category', {
    name: 'Alimentação',
    color: '#D99019',
    is_income: false,
  }, authContext);
  const categoryId = catRes.data.id;

  // Cria despesa futura para testar get_upcoming_bills
  await gateway.executeTool('create_transaction', {
    account_id: accountId,
    category_id: categoryId,
    description: 'Conta de Energia Elétrica',
    amount: 180.50,
    date: '2026-09-28',
    is_income: false,
    paid: false,
  }, authContext);

  // --------------------------------------------------------------------------
  // FLUXO 09:00: Vencimentos e Orçamentos -> WhatsApp
  // --------------------------------------------------------------------------
  // 1. Agente consulta vencimentos
  const billsRes = await gateway.executeTool('get_upcoming_bills', {
    days_ahead: 3,
  }, authContext);
  assert.equal(billsRes.status, 'ok');

  // 2. Agente consulta resumo de orçamentos
  const budgetRes = await gateway.executeTool('get_budget_summary', {
    month: '2026-09',
  }, authContext);
  assert.equal(budgetRes.status, 'ok');

  // 3. Agente envia mensagem de texto no WhatsApp (Evolution API)
  const sendAlertRes = await gateway.executeTool('whatsapp_send_message', {
    recipient: '5511999998888',
    message_type: 'text',
    text: '*Bom dia, Vitor!* ☀️\n\n📌 *Contas a vencer nos próximos dias:*\n• 28/09 - Conta de Energia Elétrica: R$ 180,50 (Pendente)',
    mock: true,
  }, authContext);
  assert.equal(sendAlertRes.status, 'ok');
  assert.equal(sendAlertRes.data.success, true);

  // --------------------------------------------------------------------------
  // FLUXO 22:00: Transações do Dia -> Resumo -> Gemini TTS -> WhatsApp
  // --------------------------------------------------------------------------
  // 1. Agente lista transações
  const txRes = await gateway.executeTool('list_transactions', {
    start_date: '2026-09-28',
    end_date: '2026-09-28',
  }, authContext);
  assert.equal(txRes.status, 'ok');

  // 2. Agente gera áudio falado com Gemini TTS (Voz Charon)
  const audioGenRes = await gateway.executeTool('gemini_generate_audio', {
    text: 'Olá Vitor. Seu fechamento financeiro de hoje foi concluído. Você teve 1 despesa pendente.',
    voice_name: 'Charon',
    model: 'gemini-2.5-flash',
    mock: true,
  }, authContext);
  assert.equal(audioGenRes.status, 'ok');
  assert.ok(audioGenRes.data.audio_base64);

  // 3. Agente dispara áudio diretamente para o WhatsApp sem depender de URL externa
  const sendVoiceRes = await gateway.executeTool('whatsapp_send_message', {
    recipient: '5511999998888',
    message_type: 'audio',
    audio_base64: audioGenRes.data.audio_base64,
    mock: true,
  }, authContext);
  assert.equal(sendVoiceRes.status, 'ok');
  assert.equal(sendVoiceRes.data.success, true);
});
