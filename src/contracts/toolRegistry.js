/**
 * Registry congelado das 62 ferramentas MCP (ECO-61).
 *
 * Princípios:
 * 1. Congelar nomes e schemas exatamente conforme catalogado sem inventar parâmetros ausentes.
 * 2. Suporte à validação estrita de input (required, types, limites).
 * 3. Provedor de metadados para adaptadores e gateways das fases posteriores.
 */

import frozenSchemas from './frozen_tool_schemas.json' with { type: 'json' };
import fixtures from './tool_fixtures.json' with { type: 'json' };

export const TOTAL_EXPECTED_TOOLS = 62;

export class ToolContractRegistry {
  constructor() {
    this.schemas = frozenSchemas;
    this.fixtures = fixtures;
    this._validateIntegrity();
  }

  _validateIntegrity() {
    const schemaKeys = Object.keys(this.schemas);
    const fixtureKeys = Object.keys(this.fixtures);

    if (schemaKeys.length !== TOTAL_EXPECTED_TOOLS) {
      throw new Error(
        `Drift de contrato: esperado ${TOTAL_EXPECTED_TOOLS} schemas, encontrado ${schemaKeys.length}.`,
      );
    }

    if (fixtureKeys.length !== TOTAL_EXPECTED_TOOLS) {
      throw new Error(
        `Drift de contrato: esperado ${TOTAL_EXPECTED_TOOLS} fixtures, encontrado ${fixtureKeys.length}.`,
      );
    }

    for (const key of schemaKeys) {
      if (!this.fixtures[key]) {
        throw new Error(`Fixture ausente para a ferramenta: ${key}`);
      }
    }
  }

  /**
   * Retorna a lista dos 62 nomes congelados.
   * @returns {string[]}
   */
  getToolNames() {
    return Object.keys(this.schemas).sort();
  }

  /**
   * Obtém a definição congelada de uma ferramenta.
   * @param {string} toolName
   */
  getTool(toolName) {
    const tool = this.schemas[toolName];
    if (!tool) {
      throw new Error(`Ferramenta desconhecida: '${toolName}' não existe no catálogo de 62 ferramentas.`);
    }
    return tool;
  }

  /**
   * Obtém fixture de chamada válida e retorno esperado para testes de contrato.
   * @param {string} toolName
   */
  getFixture(toolName) {
    const fixture = this.fixtures[toolName];
    if (!fixture) {
      throw new Error(`Fixture não encontrada para a ferramenta '${toolName}'.`);
    }
    return fixture;
  }

  /**
   * Valida parâmetros de chamada contra o inputSchema congelado.
   * @param {string} toolName
   * @param {object} args
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  validateArgs(toolName, args = {}) {
    const tool = this.getTool(toolName);
    const schema = tool.inputSchema;
    const errors = [];

    // Checar campos obrigatórios
    if (schema.required && Array.isArray(schema.required)) {
      for (const reqField of schema.required) {
        if (args[reqField] === undefined || args[reqField] === null) {
          errors.push(`Parâmetro obrigatório ausente: '${reqField}'`);
        }
      }
    }

    // Checar tipos e regras básicas
    if (args && typeof args === 'object') {
      for (const [key, val] of Object.entries(args)) {
        const propSchema = schema.properties[key];
        if (!propSchema) {
          // Parâmetro não especificado no schema do catálogo
          // Nota: toleramos ou avisamos, mas não inventamos
          continue;
        }

        if (propSchema.type === 'integer' && typeof val === 'number') {
          if (!Number.isInteger(val)) {
            errors.push(`Campo '${key}' deve ser um número inteiro.`);
          }
        } else if (propSchema.type && typeof val !== propSchema.type && propSchema.type !== 'integer') {
          if (propSchema.type === 'array' && !Array.isArray(val)) {
            errors.push(`Campo '${key}' deve ser uma lista (array).`);
          } else if (propSchema.type !== 'array') {
            errors.push(`Campo '${key}' deve ser do tipo '${propSchema.type}', recebido '${typeof val}'.`);
          }
        }

        if (propSchema.enum && !propSchema.enum.includes(val)) {
          errors.push(`Campo '${key}' deve ser um dos valores: [${propSchema.enum.join(', ')}]. Recebido: '${val}'.`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
