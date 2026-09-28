/**
 * Registry de ferramentas MCP para integrações de Agentes de IA (WhatsApp / Evolution API, Gemini Audio / TTS e Configurações).
 *
 * PRESERVAÇÃO DE CONTRATO:
 * - O ToolContractRegistry original (62 ferramentas) e ExtensionToolContractRegistry (25 ferramentas) permanecem 100% intactos.
 * - Este registry gerencia as novas capacidades de middleware de mensageria e áudio.
 */

import integrationSchemas from './integration_tool_schemas.json' with { type: 'json' };

export const TOTAL_INTEGRATION_TOOLS = 6;

export class IntegrationToolContractRegistry {
  constructor() {
    this.schemas = integrationSchemas;
    this._validateIntegrity();
  }

  _validateIntegrity() {
    const keys = Object.keys(this.schemas);
    if (keys.length !== TOTAL_INTEGRATION_TOOLS) {
      throw new Error(
        `Esperado ${TOTAL_INTEGRATION_TOOLS} ferramentas de integração, encontrado ${keys.length}.`,
      );
    }
  }

  getToolNames() {
    return Object.keys(this.schemas).sort();
  }

  getTool(toolName) {
    const tool = this.schemas[toolName];
    if (!tool) {
      throw new Error(`Ferramenta de integração desconhecida: '${toolName}'.`);
    }
    return tool;
  }

  validateArgs(toolName, args = {}) {
    const tool = this.getTool(toolName);
    const schema = tool.inputSchema;
    const errors = [];

    if (schema.required && Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (args[req] === undefined || args[req] === null || args[req] === '') {
          errors.push(`Parâmetro obrigatório ausente: '${req}'`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
