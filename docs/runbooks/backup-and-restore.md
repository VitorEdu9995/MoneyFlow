# Runbook: Backup Criptografado e Restauração Segura (Fase 6 / ECO-66)

## 1. Visão Geral
Este runbook descreve o procedimento operacional padrão para geração e restauração de backups criptografados no MoneyFlow.

- **Algoritmo de Criptografia:** AES-256-GCM com autenticação integrada (Auth Tag de 16 bytes).
- **Derivação de Chave:** `scrypt` com salt aleatório criptográfico de 16 bytes.
- **Integridade:** Checksum SHA-256 verificado antes da gravação e após a descriptografia.
- **Validação de Banco:** `PRAGMA integrity_check` executado imediatamente após a restauração.
- **Proteção contra Path Traversal:** Nomes relativos de arquivos de anexos são normalizados e confinados estritamente dentro da pasta de destino.

---

## 2. Geração de Backup Criptografado

### Execução Programática ou via Script
```javascript
import { BackupRestoreService } from './src/ops/backupRestoreService.js';

const result = await BackupRestoreService.createEncryptedBackup({
  dbPath: './.data/moneyflow.db',
  attachmentsDir: './.data/attachments',
  backupPath: './backups/moneyflow-2026-09-27.enc',
  secretKey: process.env.MONEYFLOW_BACKUP_KEY, // Mínimo de 16 caracteres
});

console.log('Backup concluído:', result);
// Retorna: { backupPath, checksumSha256, filesCount, sizeBytes, createdAt }
```

### Validações de Pré-Requisitos
1. Certifique-se de que a variável de ambiente `MONEYFLOW_BACKUP_KEY` contenha pelo menos 16 caracteres de alta entropia.
2. Certifique-se de que o diretório de destino do backup possua espaço em disco suficiente.

---

## 3. Restauração e Recuperação de Desastre (Disaster Recovery)

### Execução em Ambiente Isolado de Teste
Nunca restaure diretamente sobre o banco de produção sem antes validar em um diretório isolado de staging/teste:

```javascript
import { BackupRestoreService } from './src/ops/backupRestoreService.js';

const restoreResult = await BackupRestoreService.restoreEncryptedBackup({
  backupPath: './backups/moneyflow-2026-09-27.enc',
  targetDbPath: './test_restore/moneyflow.db',
  targetAttachmentsDir: './test_restore/attachments',
  secretKey: process.env.MONEYFLOW_BACKUP_KEY,
});

console.log('Restauração validada com sucesso:', restoreResult);
```

### Comportamento em Caso de Falha / Adulteração
- **Chave incorreta:** O processo aborta com erro 400 (`Falha de autenticação do backup: chave incorreta ou dados corrompidos/truncados.`) e nenhum arquivo corrompido é mantido.
- **Arquivo truncado ou cortado na metade:** Aborta na validação do cabeçalho ou na tag GCM.
- **Banco de dados corrompido:** Caso o arquivo SQLite falhe no `PRAGMA integrity_check;`, o arquivo é imediatamente removido e um erro 500 é lançado.

---

## 4. Política de Retenção e Segurança
1. Backups devem ser armazenados em bucket S3/GCS privado com criptografia em repouso (SSE-KMS) e versionamento ativado.
2. A chave de backup deve ser armazenada exclusivamente em cofre de senhas (ex: HashiCorp Vault, AWS Secrets Manager, 1Password Secrets).
3. Nunca comite arquivos `.enc` ou chaves nos repositórios git.
