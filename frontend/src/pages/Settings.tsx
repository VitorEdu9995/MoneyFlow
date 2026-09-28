import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import {
  Sparkles,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Play,
  Send,
  Save,
  Eye,
  EyeOff,
  Volume2,
  RefreshCw,
  Cpu,
  KeyRound
} from 'lucide-react';

interface IntegrationSettings {
  evolution: {
    configured: boolean;
    apiUrl: string;
    apiKeyMasked: string;
    instanceName: string;
  };
  gemini: {
    configured: boolean;
    apiKeyMasked: string;
    defaultVoice: string;
    defaultModel: string;
  };
  settings: Record<string, any>;
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estados dos formulários
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiVoice, setGeminiVoice] = useState('Charon');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [evolutionUrl, setEvolutionUrl] = useState('');
  const [evolutionKey, setEvolutionKey] = useState('');
  const [evolutionInstance, setEvolutionInstance] = useState('');
  const [showEvolutionKey, setShowEvolutionKey] = useState(false);

  // Status de testes
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [testingEvolution, setTestingEvolution] = useState(false);
  const [evolutionTestResult, setEvolutionTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Playground de Áudio e WhatsApp
  const [testText, setTestText] = useState('Olá Vitor! Este é um teste do sintetizador de áudio Gemini TTS integrado ao MoneyFlow.');
  const [testRecipient, setTestRecipient] = useState('');
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [whatsappResult, setWhatsappResult] = useState<string | null>(null);

  // Carrega configurações existentes
  const loadSettings = async () => {
    setLoading(true);
    try {
      const data: IntegrationSettings = await apiExecute('get_integration_settings', {});
      if (data) {
        setGeminiVoice(data.gemini.defaultVoice || 'Charon');
        setGeminiModel(data.gemini.defaultModel || 'gemini-2.5-flash');
        if (data.gemini.apiKeyMasked) {
          setGeminiApiKey(data.gemini.apiKeyMasked);
        }

        setEvolutionUrl(data.evolution.apiUrl || '');
        setEvolutionInstance(data.evolution.instanceName || '');
        if (data.evolution.apiKeyMasked) {
          setEvolutionKey(data.evolution.apiKeyMasked);
        }
      }
    } catch (err: any) {
      console.error('Erro ao carregar configurações:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Salvar configurações
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    try {
      const payload: Record<string, any> = {
        gemini_default_voice: geminiVoice,
        gemini_default_model: geminiModel,
        evolution_api_url: evolutionUrl,
        evolution_instance_name: evolutionInstance,
      };

      // Só envia se for uma chave nova (não mascarada)
      if (geminiApiKey && !geminiApiKey.includes('••••')) {
        payload.gemini_api_key = geminiApiKey;
      }
      if (evolutionKey && !evolutionKey.includes('••••')) {
        payload.evolution_api_key = evolutionKey;
      }

      await apiExecute('update_integration_settings', payload);
      setStatusMessage({ type: 'success', text: 'Configurações de integração salvas e criptografadas com sucesso!' });
      await loadSettings();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Falha ao salvar configurações.' });
    } finally {
      setSaving(false);
    }
  };

  // Testar chave Gemini
  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const testKeyArg = geminiApiKey && !geminiApiKey.includes('••••') ? geminiApiKey : undefined;
      const res = await apiExecute('test_gemini_connection', { api_key: testKeyArg });
      if (res.valid) {
        setGeminiTestResult({ ok: true, msg: res.message || 'Chave validada com sucesso!' });
      } else {
        setGeminiTestResult({ ok: false, msg: res.message || 'Chave não autorizada pelo Google.' });
      }
    } catch (err: any) {
      setGeminiTestResult({ ok: false, msg: err.message || 'Erro ao conectar à API do Gemini.' });
    } finally {
      setTestingGemini(false);
    }
  };

  // Testar conexão WhatsApp
  const handleTestEvolution = async () => {
    setTestingEvolution(true);
    setEvolutionTestResult(null);
    try {
      const res = await apiExecute('test_whatsapp_connection', { instance_name: evolutionInstance || undefined });
      if (res.connected) {
        setEvolutionTestResult({ ok: true, msg: res.message || 'WhatsApp conectado e operacional!' });
      } else {
        setEvolutionTestResult({ ok: false, msg: res.message || 'Instância não conectada no Evolution API.' });
      }
    } catch (err: any) {
      setEvolutionTestResult({ ok: false, msg: err.message || 'Erro ao comunicar com a Evolution API.' });
    } finally {
      setTestingEvolution(false);
    }
  };

  // Gerar Áudio de Teste
  const handleGenerateAudio = async () => {
    setGeneratingAudio(true);
    setAudioUrl(null);
    setAudioBase64(null);
    try {
      const res = await apiExecute('gemini_generate_audio', {
        text: testText,
        voice_name: geminiVoice,
        model: geminiModel,
      });

      if (res.audio_base64) {
        setAudioBase64(res.audio_base64);
        setAudioUrl(`data:${res.mime_type || 'audio/wav'};base64,${res.audio_base64}`);
      } else if (res.local_url) {
        setAudioUrl(res.local_url);
      }
    } catch (err: any) {
      alert(`Erro ao gerar áudio: ${err.message}`);
    } finally {
      setGeneratingAudio(false);
    }
  };

  // Disparar WhatsApp de Teste
  const handleSendTestWhatsapp = async (type: 'text' | 'audio') => {
    if (!testRecipient) {
      alert('Informe o número de telefone com DDD (ex: 11999999999)');
      return;
    }

    setSendingWhatsapp(true);
    setWhatsappResult(null);
    try {
      const payload: Record<string, any> = {
        recipient: testRecipient,
        message_type: type,
        instance_name: evolutionInstance || undefined,
      };

      if (type === 'text') {
        payload.text = testText;
      } else {
        if (!audioBase64) {
          alert('Gere o áudio primeiro antes de enviar como mensagem de voz.');
          setSendingWhatsapp(false);
          return;
        }
        payload.audio_base64 = audioBase64;
      }

      const res = await apiExecute('whatsapp_send_message', payload);
      setWhatsappResult(`✅ Mensagem enviada com sucesso! ID: ${res.messageId || 'OK'}`);
    } catch (err: any) {
      setWhatsappResult(`❌ Falha no envio: ${err.message}`);
    } finally {
      setSendingWhatsapp(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold text-azulFluxo tracking-tight flex items-center">
          <Cpu className="w-6 h-6 mr-3 text-verdeEquilibrio" />
          Configurações & Integrações de IA
        </h1>
        <p className="text-sm text-texto/70 mt-1">
          Gerencie chaves criptografadas de inteligência artificial, canais de notificação do WhatsApp e síntese de voz para agentes autônomos.
        </p>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl flex items-center space-x-3 text-sm font-medium ${
            statusMessage.type === 'success' ? 'bg-verdeEquilibrio/10 text-verdeEquilibrio border border-verdeEquilibrio/20' : 'bg-coralEscuro/10 text-coralEscuro border border-coralEscuro/20'
          }`}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-texto/60 flex items-center justify-center space-x-3">
          <RefreshCw className="w-5 h-5 animate-spin text-verdeEquilibrio" />
          <span>Carregando configurações de integração...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Card 1: Google Gemini (Áudio / TTS) */}
            <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-card space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-black/5">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-azulFluxo/5 flex items-center justify-center text-azulFluxo">
                    <Sparkles className="w-5 h-5 text-verdeEquilibrio" />
                  </div>
                  <div>
                    <h2 className="font-bold text-azulFluxo text-base">Google Gemini (Áudio & TTS)</h2>
                    <p className="text-xs text-texto/60">Síntese de voz e resumos diários para agentes</p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    geminiApiKey
                      ? 'bg-verdeEquilibrio/10 text-verdeEquilibrio'
                      : 'bg-ambar/10 text-ambar'
                  }`}
                >
                  {geminiApiKey ? 'Ativo' : 'Pendente'}
                </span>
              </div>

              {/* Input API Key */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                  Gemini API Key (Google AI Studio)
                </label>
                <div className="relative">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full text-sm font-mono px-3.5 py-2.5 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-texto/40 hover:text-texto cursor-pointer"
                  >
                    {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-texto/60 flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1 text-verdeEquilibrio" />
                  Chaves salvas são protegidas com criptografia nativa <strong>AES-256-GCM</strong>.
                </p>
              </div>

              {/* Voz e Modelo */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                    Voz Padrão
                  </label>
                  <select
                    value={geminiVoice}
                    onChange={(e) => setGeminiVoice(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio bg-white cursor-pointer"
                  >
                    <option value="Charon">Charon (Masculina Firme)</option>
                    <option value="Aoede">Aoede (Feminina Natural)</option>
                    <option value="Puck">Puck (Jovem Dinâmica)</option>
                    <option value="Fenrir">Fenrir (Profunda)</option>
                    <option value="Kore">Kore (Suave / Calma)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                    Modelo de Síntese
                  </label>
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio bg-white cursor-pointer"
                  >
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                  </select>
                </div>
              </div>

              {/* Botão de Teste */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleTestGemini}
                  disabled={testingGemini}
                  className="text-xs font-semibold text-azulFluxo bg-black/5 hover:bg-black/10 px-3.5 py-2 rounded-lg transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  {testingGemini ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  <span>Testar Chave Gemini</span>
                </button>

                {geminiTestResult && (
                  <span
                    className={`text-xs font-medium ${
                      geminiTestResult.ok ? 'text-verdeEquilibrio' : 'text-coralEscuro'
                    }`}
                  >
                    {geminiTestResult.msg}
                  </span>
                )}
              </div>
            </div>

            {/* Card 2: WhatsApp (Evolution API) */}
            <div className="bg-white rounded-2xl p-6 border border-black/5 shadow-card space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-black/5">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-azulFluxo/5 flex items-center justify-center text-azulFluxo">
                    <MessageSquare className="w-5 h-5 text-verdeEquilibrio" />
                  </div>
                  <div>
                    <h2 className="font-bold text-azulFluxo text-base">WhatsApp (Evolution API)</h2>
                    <p className="text-xs text-texto/60">Middleware de notificações e envio de áudios</p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    evolutionUrl && evolutionInstance
                      ? 'bg-verdeEquilibrio/10 text-verdeEquilibrio'
                      : 'bg-ambar/10 text-ambar'
                  }`}
                >
                  {evolutionUrl ? 'Configurado' : 'Pendente'}
                </span>
              </div>

              {/* URL da Evolution API */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                  Evolution API URL
                </label>
                <input
                  type="url"
                  value={evolutionUrl}
                  onChange={(e) => setEvolutionUrl(e.target.value)}
                  placeholder="https://evolution.seu-dominio.com.br"
                  className="w-full text-sm font-mono px-3.5 py-2.5 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
                />
              </div>

              {/* Nome da Instância e API Key */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                    Nome da Instância
                  </label>
                  <input
                    type="text"
                    value={evolutionInstance}
                    onChange={(e) => setEvolutionInstance(e.target.value)}
                    placeholder="moneyflow"
                    className="w-full text-sm font-mono px-3.5 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
                    Evolution API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showEvolutionKey ? 'text' : 'password'}
                      value={evolutionKey}
                      onChange={(e) => setEvolutionKey(e.target.value)}
                      placeholder="apikey"
                      className="w-full text-sm font-mono px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEvolutionKey(!showEvolutionKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-texto/40 hover:text-texto cursor-pointer"
                    >
                      {showEvolutionKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Botão de Teste */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleTestEvolution}
                  disabled={testingEvolution}
                  className="text-xs font-semibold text-azulFluxo bg-black/5 hover:bg-black/10 px-3.5 py-2 rounded-lg transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  {testingEvolution ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                  <span>Testar Conexão WhatsApp</span>
                </button>

                {evolutionTestResult && (
                  <span
                    className={`text-xs font-medium ${
                      evolutionTestResult.ok ? 'text-verdeEquilibrio' : 'text-coralEscuro'
                    }`}
                  >
                    {evolutionTestResult.msg}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Botão de Salvar Global */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-verdeEquilibrio hover:bg-verdeEquilibrio/90 text-white font-semibold px-6 py-2.5 rounded-xl shadow-sm transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Salvar Todas as Configurações</span>
            </button>
          </div>
        </form>
      )}

      {/* Card 3: Playground de Teste (Áudio & WhatsApp) */}
      <div className="bg-gradient-to-br from-azulFluxo/5 via-white to-verdeEquilibrio/5 rounded-2xl p-6 border border-black/5 shadow-card space-y-6">
        <div className="flex items-center space-x-3 pb-4 border-b border-black/5">
          <div className="w-10 h-10 rounded-xl bg-verdeEquilibrio/10 text-verdeEquilibrio flex items-center justify-center">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-azulFluxo text-base">Playground de Teste em Tempo Real</h2>
            <p className="text-xs text-texto/60">
              Teste a síntese de áudio Gemini TTS e o envio direto para o seu WhatsApp antes de conectar o agente autônomo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Texto para síntese */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
              Texto para Síntese de Áudio (Voz {geminiVoice})
            </label>
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              rows={4}
              className="w-full text-sm p-3 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio bg-white resize-none"
              placeholder="Digite a mensagem para o Gemini narrar..."
            />
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleGenerateAudio}
                disabled={generatingAudio}
                className="bg-azulFluxo text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-azulFluxo/90 transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {generatingAudio ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Gerar Áudio com Voz {geminiVoice}</span>
              </button>

              {audioUrl && (
                <div className="flex-1">
                  <audio controls src={audioUrl} className="w-full h-8" />
                </div>
              )}
            </div>
          </div>

          {/* Disparo no WhatsApp */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-azulFluxo uppercase tracking-wider block">
              Disparo de Teste no WhatsApp
            </label>
            <input
              type="tel"
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="5511999998888 (com DDI e DDD)"
              className="w-full text-sm font-mono px-3.5 py-2.5 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio bg-white"
            />
            <p className="text-[11px] text-texto/60">
              Informe o seu número pessoal para validar o recebimento do texto e do áudio.
            </p>
            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => handleSendTestWhatsapp('text')}
                disabled={sendingWhatsapp}
                className="bg-verdeEquilibrio text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-verdeEquilibrio/90 transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar Texto</span>
              </button>

              <button
                type="button"
                onClick={() => handleSendTestWhatsapp('audio')}
                disabled={sendingWhatsapp || !audioBase64}
                className="bg-azulFluxo text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-azulFluxo/90 transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                title={!audioBase64 ? 'Gere o áudio antes de disparar' : ''}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Enviar Áudio (Voz)</span>
              </button>
            </div>

            {whatsappResult && (
              <p className="text-xs font-medium text-azulFluxo bg-white/80 p-2.5 rounded-lg border border-black/5 mt-2">
                {whatsappResult}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
