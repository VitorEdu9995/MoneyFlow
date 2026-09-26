/**
 * Registry complementar para as ferramentas MCP da Extensão da Fase 1 (ECO-61 Extensão).
 *
 * IMPORTANTE:
 * - O contrato das 62 ferramentas originais em ToolContractRegistry permanece INTACTO e CONGELADO.
 * - Este registry gerencia as novas ferramentas de atributos, locais, produtos, compras/itens,
 *   devoluções e histórico de preços sem colidir nem modificar o contrato base.
 */

import extensionSchemas from './extension_tool_schemas.json' with { type: 'json' };

export const TOTAL_EXTENSION_TOOLS = 13;

export class ExtensionToolContractRegistry {
  constructor() {
    this.schemas = extensionSchemas;
    this._validateIntegrity();
  }

  _validateIntegrity() {
    const keys = Object.keys(this.schemas);
    if (keys.length !== TOTAL_EXTENSION_TOOLS) {
      throw new Error(
        `Esperado ${TOTAL_EXTENSION_TOOLS} ferramentas de extensão, encontrado ${keys.length}.`,
      );
    }
  }

  getToolNames() {
    return Object.keys(this.schemas).sort();
  }

  getTool(toolName) {
    const tool = this.schemas[toolName];
    if (!tool) {
      throw new Error(`Ferramenta de extensão desconhecida: '${toolName}'.`);
    }
    return tool;
  }

  validateArgs(toolName, args = {}) {
    const tool = this.getTool(toolName);
    const schema = tool.inputSchema;
    const errors = [];

    if (schema.required && Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (args[req] === undefined || args[req] === null) {
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
