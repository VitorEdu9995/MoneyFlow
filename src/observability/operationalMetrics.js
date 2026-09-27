const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  rateLimit: 20,
  serverError: 10,
  idor: 1,
  authorization: 10,
  redaction: 20,
  storageFailure: 1,
});

function asNonNegativeInteger(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function alertKey(type) {
  return type.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Coletor local, em memória e somente agregado para telemetria operacional.
 * Não retém usuário, espaço, IP, URL com query, payloads, tokens ou anexos.
 */
export class OperationalMetrics {
  constructor({ alertThresholds = {}, now = () => Date.now(), onAlert = null } = {}) {
    this.now = now;
    this.onAlert = onAlert;
    this.thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...alertThresholds };
    this.startedAt = now();
    this.api = { requests: 0, errors4xx: 0, errors5xx: 0, latencyTotal: 0, latencyMax: 0 };
    this.rateLimits = { global: 0, userIp: 0, attachmentDownloadUrl: 0 };
    this.security = { authorization: 0, idor: 0 };
    this.auditEvents = 0;
    this.redactions = 0;
    this.storage = { attachments: 0, bytes: 0, failures: 0 };
    this.alerts = [];
  }

  _emitAlert(type, count) {
    const threshold = this.thresholds[alertKey(type)];
    if (!Number.isFinite(threshold) || threshold < 1 || count !== threshold) return;
    const alert = {
      type,
      severity: type === 'idor' || type === 'storage_failure' ? 'high' : 'warning',
      count,
      threshold,
      timestamp: new Date(this.now()).toISOString(),
    };
    this.alerts.push(alert);
    if (this.alerts.length > 100) this.alerts.shift();
    try { this.onAlert?.(alert); } catch { /* alerta não pode interromper a aplicação */ }
  }

  recordApiRequest({ status, latencyMs }) {
    this.api.requests += 1;
    const numericStatus = Number(status);
    if (numericStatus >= 400 && numericStatus < 500) this.api.errors4xx += 1;
    if (numericStatus >= 500) {
      this.api.errors5xx += 1;
      this._emitAlert('server_error', this.api.errors5xx);
    }
    const latency = Math.max(0, Number(latencyMs) || 0);
    this.api.latencyTotal += latency;
    this.api.latencyMax = Math.max(this.api.latencyMax, latency);
  }

  recordRateLimit({ scope = 'user_ip' } = {}) {
    const metric = scope === 'global' ? 'global'
      : scope === 'attachment_download_url' ? 'attachmentDownloadUrl'
        : 'userIp';
    this.rateLimits[metric] += 1;
    this._emitAlert('rate_limit', this.rateLimits[metric]);
  }

  recordSecurityFailure({ category = 'authorization' } = {}) {
    const metric = category === 'idor' ? 'idor' : 'authorization';
    this.security[metric] += 1;
    this._emitAlert(metric, this.security[metric]);
  }

  recordRedaction() {
    this.redactions += 1;
    this._emitAlert('redaction', this.redactions);
  }

  recordAuditEvent() {
    this.auditEvents += 1;
  }

  recordStorageUsage({ attachments, bytes } = {}) {
    this.storage.attachments = asNonNegativeInteger(attachments);
    this.storage.bytes = asNonNegativeInteger(bytes);
  }

  recordStorageFailure() {
    this.storage.failures += 1;
    this._emitAlert('storage_failure', this.storage.failures);
  }

  snapshot() {
    const requests = this.api.requests;
    return {
      uptimeMs: Math.max(0, this.now() - this.startedAt),
      api: {
        requests,
        errors4xx: this.api.errors4xx,
        errors5xx: this.api.errors5xx,
        errorRate: requests === 0 ? 0 : Number(((this.api.errors4xx + this.api.errors5xx) / requests).toFixed(4)),
        latencyMs: {
          count: requests,
          average: requests === 0 ? 0 : Number((this.api.latencyTotal / requests).toFixed(2)),
          max: this.api.latencyMax,
        },
      },
      rateLimits: { ...this.rateLimits },
      security: { ...this.security },
      auditEvents: this.auditEvents,
      redactions: this.redactions,
      storage: { ...this.storage },
      alerts: this.alerts.map((alert) => ({ ...alert })),
    };
  }
}
