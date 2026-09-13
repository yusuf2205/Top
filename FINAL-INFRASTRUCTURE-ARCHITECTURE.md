# TOP PROCUREMENT — FINAL INFRASTRUCTURE ARCHITECTURE (v1, ожидает вашего подтверждения)

Статус: **Draft final — блокирует M0 до вашего явного "подтверждаю".** Консолидирует и заменяет собой рабочие версии решений из `ARCHITECTURE.md` и `INFRASTRUCTURE.md` там, где вы внесли уточнения; там, где изменений нет — просто ссылается на них, а не дублирует.

Сначала — таблица трассируемости: каждое из ваших 18 пунктов явно закрыто и видно, где именно.

| # | Ваше решение | Статус | Где отражено |
|---|---|---|---|
| 1 | UGREEN DXP4800 Plus — единственная инфраструктура MVP, без managed cloud services | ✅ Locked | Раздел A |
| 2 | Приложение не привязано к UGREEN — переносимость обязательна | ✅ Locked (уже было) | Раздел G |
| 3 | Postgres/MinIO физически на NAS, но через стандартные интерфейсы (S3-compatible) | ✅ Locked (уже было) | Раздел D |
| 4 | Backup обязателен, RAID ≠ Backup, нужна abstraction под второй destination | ✅ Locked + добавлена abstraction | Раздел E |
| 5 | Всё через Docker Compose, отдельные env-файлы для окружений, без Kubernetes/microservices | ✅ Locked | Раздел B |
| 6 | Product Master → Phase 2, но не блокировать его добавление | ✅ Подтверждено, путь миграции описан | Раздел "Product Master extensibility" |
| 7 | Ask TOP AI → Phase 2, но AI-архитектура должна позволить добавить | ✅ Подтверждено (уже было решено) | Раздел "AI extensibility" |
| 8 | OCR: без отдельного сервиса сейчас, но нужен interface/abstraction | ✅ Добавлен `OCRProvider` interface | Раздел "OCR abstraction" |
| 9 | Anthropic — primary provider, `AIProvider` абстракция обязательна | ✅ Подтверждено (уже было) | Раздел "AI provider" |
| 10 | AI cost tracking — structured logs с конкретным набором полей | ✅ Поля зафиксированы точно как вы указали | Раздел "AI cost logging" |
| 11 | AI никогда не утверждает/не создаёт PO/не меняет цену-кол-во-НДС-валюту самостоятельно | ✅ Подтверждено, enforcement объяснён | Раздел "AI guardrails" |
| 12 | Backend считает деньги, только Decimal, никогда float | ✅ Уже реализовано в schema | Без изменений, ARCHITECTURE.md §5 |
| 13 | Uzbekistan readiness: UZS/USD/EUR/RUB/CNY/TRY + configurable VAT, без Didox/E-IMZO/SAP в MVP | ✅ Подтверждено, уточнение по валютам | Раздел "Currency & Tax readiness" |
| 14 | Supplier Portal — без аккаунта, но token с чёткими ограничениями | ✅ Уже реализовано, зафиксировано повторно | Раздел "Supplier Portal security" |
| 15 | Tenant isolation — многоуровневая защита + обязательный тест на каждый модуль | ✅ Без изменений | ARCHITECTURE.md §1.5, ниже — тест-процедура |
| 16 | M0 должен включать 9 конкретных пунктов (health checks, volumes, network isolation и т.д.) | ✅ Definition of Done | Раздел "M0 Definition of Done" |
| 17 | Backup обязательно тестировать восстановлением (БД и MinIO) | ✅ Процедура описана | Раздел "Restore Test Procedure" |
| 18 | Не переходить к коду всего проекта — сначала A–H | ✅ Соблюдается | Этот документ = A–H, дальше — стоп |

---

## A. Final UGREEN Infrastructure Architecture

```text
                         INTERNET
                            │
                    Router / Firewall
                     (port-forward ТОЛЬКО 80, 443)
                            │
                            ▼
                 UGREEN DXP4800 Plus (bare metal)
                            │
                       Docker Engine
                            │
              ┌─────────────┴─────────────┐
              │     Docker network:        │
              │       top_internal         │
              │                            │
              │  top-reverse-proxy         │
              │  (публикует 80/443)        │
              │        │                   │
              │   ┌────┴────┐              │
              │   ▼         ▼              │
              │ top-web   top-api ─────┐   │
              │             │          │   │
              │        ┌────┼────┐     │   │
              │        ▼    ▼    ▼     │   │
              │  top-postgres  top-redis│   │
              │        ▲               │   │
              │        │          top-minio │
              │   top-worker ───────────┘   │
              │        │                    │
              │        ▼ (исходящий HTTPS)  │
              │   Anthropic API             │
              └────────────────────────────┘
                            │
                   NAS Storage Pools
              ┌─────────────┴─────────────┐
              ▼                            ▼
        NVMe pool (2×M.2)            SATA pool (4×bay)
     Postgres data, Redis AOF      MinIO документы, Backups
```

**Явное подтверждение по пункту 1:** ни один managed cloud service (RDS/ElastiCache/S3/Azure DB/Cloud SQL) не используется в MVP. Единственная внешняя зависимость, которая физически не на NAS — это вызов Anthropic API по HTTPS (исходящий, не входящий трафик) для AI extraction/recommendation, поскольку локальный LLM на железе без GPU не рассматривается как часть MVP (согласовано в п.9) — это единственная "объективная техническая необходимость" выйти за периметр NAS, и она осознанная, а не default-to-cloud привычка.

---

## B. Docker Compose Architecture

### B.1 Файловая структура (без дублирования конфигурации)

```text
docker-compose.yml            # базовые определения сервисов, networks, volumes — общее для всех окружений
docker-compose.override.yml   # (автоматически подхватывается) — development-специфика: build вместо image, hot-reload
docker-compose.staging.yml    # override: staging домен/ресурсы
docker-compose.prod.yml       # override: production — resource limits, restart policy, image вместо build, no debug ports
```

Запуск: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`. Причина такого паттерна (а не три независимых полных файла): единый source of truth для того, что не меняется между окружениями (имена сервисов, networks, volume mounts, healthchecks) — исключает рассинхронизацию, когда staging тихо отстаёт от prod по структуре.

### B.2 Базовый `docker-compose.yml`

```yaml
name: top-procurement

networks:
  top_internal:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  minio_data:
  backup_data:
  proxy_certs:

services:
  reverse-proxy:
    image: traefik:v3
    networks: [top_internal]
    ports: ["80:80", "443:443"]
    volumes:
      - proxy_certs:/certs
      - /var/run/docker.sock:/var/run/docker.sock:ro
    healthcheck:
      test: ["CMD", "traefik", "healthcheck"]
      interval: 30s

  web:
    image: top-web:${TAG:-latest}
    networks: [top_internal]
    env_file: .env
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s

  api:
    image: top-api:${TAG:-latest}
    networks: [top_internal]
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      minio:    { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 15s

  worker:
    image: top-worker:${TAG:-latest}
    networks: [top_internal]
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      minio:    { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]   # проверка: воркер подключён к очереди
      interval: 30s

  postgres:
    image: postgres:16-alpine
    networks: [top_internal]
    env_file: .env
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
      interval: 10s

  redis:
    image: redis:7-alpine
    networks: [top_internal]
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    networks: [top_internal]
    env_file: .env
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 15s

  backup:
    image: top-backup:${TAG:-latest}
    networks: [top_internal]
    env_file: .env
    volumes:
      - postgres_data:/pgdata:ro
      - minio_data:/miniodata:ro
      - backup_data:/backups
    depends_on:
      postgres: { condition: service_healthy }
      minio:    { condition: service_healthy }
```

**Ни у одного сервиса, кроме `reverse-proxy`, нет секции `ports:`** — это и есть network isolation на уровне Compose-файла, а не просто описание словами.

### B.3 `docker-compose.prod.yml` (override)

```yaml
services:
  reverse-proxy:
    restart: always
    deploy:
      resources: { limits: { cpus: "0.3", memory: 128M } }
    labels:
      - "traefik.http.routers.web.rule=Host(`${WEB_DOMAIN}`)"
      - "traefik.http.routers.api.rule=Host(`${API_DOMAIN}`)"
      - "traefik.http.routers.web.tls.certresolver=letsencrypt"

  web:     { restart: always, deploy: { resources: { limits: { cpus: "0.5", memory: 512M } } } }
  api:     { restart: always, deploy: { resources: { limits: { cpus: "1.0", memory: 1024M } } } }
  worker:  { restart: always, deploy: { resources: { limits: { cpus: "0.7", memory: 768M } } } }
  postgres:{ restart: always, deploy: { resources: { limits: { cpus: "1.5", memory: 3072M } } } }
  redis:   { restart: always, deploy: { resources: { limits: { cpus: "0.3", memory: 256M } } } }
  minio:   { restart: always, deploy: { resources: { limits: { cpus: "0.5", memory: 512M } } } }
  backup:  { restart: "no" }   # запускается по расписанию (cron/systemd timer на хосте, вызывает docker compose run), не как daemon
```

`docker-compose.staging.yml` — структурно идентичен `prod`, но с отдельными volume-именами/доменами (`WEB_DOMAIN=staging.app.<domain>`) и, при желании, урезанными resource limits — чтобы staging не конкурировал за ресурсы с production на одном и том же NAS во время тестов перед релизом.

---

## C. Network Architecture

Без изменений по существу относительно `INFRASTRUCTURE.md §STEP4` — подтверждаю финально:

```text
Internet ──(443 HTTPS, 80→redirect)──▶ Router (port-forward только 80/443) ──▶ top-reverse-proxy
                                                                                      │
                                                            ┌─────────────────────────┼─────────────────────────┐
                                                            ▼                         ▼
                                                          top-web                   top-api ──▶ postgres/redis/minio (internal only)
                                                                                       │
                                                                                  top-worker ──▶ исходящий HTTPS к Anthropic API
```

- Postgres (5432) / Redis (6379) / MinIO (9000/9001) — **нет `ports:` в Compose ни в одном окружении**, включая production. Это не просто firewall-правило, а структурное отсутствие возможности достучаться снаружи.
- Административный доступ к UGOS/SSH — через WireGuard VPN, не публичный интернет.
- Rate limiting на `/auth/login` и `/portal/*` — middleware на уровне Traefik (`top-reverse-proxy`) плюс guard на уровне NestJS для defense in depth.

---

## D. Storage / Volume Layout

| Volume | Host path (пример) | Physical pool | Контейнер / mount | Назначение | Backup priority |
|---|---|---|---|---|---|
| `postgres_data` | `/volume_nvme/docker/top/postgres` | NVMe (2×M.2) | `top-postgres:/var/lib/postgresql/data` | Все транзакционные данные системы | Критично — ежедневно |
| `redis_data` | `/volume_nvme/docker/top/redis` | NVMe | `top-redis:/data` | Очереди BullMQ (transient) + AOF | Низкий — восстановимо без backup (очереди не источник истины) |
| `minio_data` | `/volume_sata/docker/top/minio` | SATA (4×bay) | `top-minio:/data` | Все документы (КП, PO, спецификации, сканы) | Критично — ежедневно, инкрементально |
| `backup_data` | `/volume_sata/docker/top/backups` | SATA | `top-backup:/backups` | Локальная копия перед отправкой offsite | — (сама является backup-слоем) |
| `proxy_certs` | `/volume_nvme/docker/top/certs` | NVMe | `top-reverse-proxy:/certs` | TLS-сертификаты Let's Encrypt | Низкий — переиздаётся автоматически при потере |

**Явные bind-mount пути (а не безымянные Docker volumes)** — сознательное решение: именованные Docker volumes без `driver_opts` кладутся туда, где Docker Engine хранит данные по умолчанию, что не гарантирует нужный физический pool (NVMe vs SATA). Явный host path даёт контроль над тем, какие данные попадают на быстрый, а какие — на ёмкий storage, как описано в п.3.

MinIO bucket layout — без изменений: `top-documents/organizations/org-<uuid>/{suppliers,rfq,quotes,purchase-orders,contracts}/...`. Приложение обращается к нему **только через S3 API** (`@aws-sdk/client-s3`), конфигурация — 4 переменные окружения (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`). Замена MinIO → S3/R2/B2 = смена значений этих переменных, ноль изменений кода — это и есть требование п.3.

---

## E. Backup Architecture

### E.1 Принцип (п.4)

**RAID ≠ Backup.** RAID на SATA pool защищает от отказа диска, не от удаления/порчи/отказа всего NAS. Обязательна независимая цепочка с возможностью второго destination.

### E.2 Backup target abstraction

Чтобы не усложнять сейчас, но не блокировать второй destination позже (как явно просите в п.4), backup-скрипт спроектирован вокруг одного интерфейса, а не завязан на конкретную команду:

```bash
# infrastructure/backup/targets/local.sh, offsite-s3.sh, offsite-rsync.sh — единый контракт:
backup_target_push() {
  local source_path="$1"   # локальный дамп/снэпшот
  local dest_label="$2"    # "postgres-daily" | "minio-incremental"
  # реализация конкретного target'а — local copy / rclone to S3-compatible / rsync to second NAS
}
```

`backup.sh` вызывает `backup_target_push` для каждого сконфигурированного target'а из списка в `.env` (`BACKUP_TARGETS=local,offsite-s3` или просто `local`, пока второй destination не выбран организационно). Добавление второго destination в будущем — это новый файл `targets/*.sh` + строка в `.env`, не рефакторинг.

### E.3 Поток

```text
top-postgres ──(pg_dump, ночью)──▶ backup_data (SATA, локально) ──▶ [опционально] offsite target
top-minio    ──(rclone/mc mirror, инкрементально)──▶ backup_data ──▶ [опционально] offsite target
git (docker-compose*, Prisma migrations, .env.*.example) ──▶ уже offsite по своей природе (репозиторий вне NAS)
.env.production (реальные secrets) ──▶ зашифрованный архив (age/gpg) ──▶ backup_data ──▶ [опционально] offsite target
```

### E.4 Retention

| Что | Периодичность | Retention |
|---|---|---|
| PostgreSQL dump | Ежедневно | 7 daily + 4 weekly + 3 monthly |
| MinIO sync | Ежедневно, инкрементально | Синхронно с БД + bucket versioning на случай перезаписи/удаления объекта |
| Secrets archive | При изменении | Последние 5 версий |

---

## F. Security Architecture

Сводка (детали — `INFRASTRUCTURE.md §STEP7`, без изменений по существу):

| Слой | Мера |
|---|---|
| Периметр | Только 80/443 port-forward; всё остальное — LAN или WireGuard VPN |
| TLS | Traefik + Let's Encrypt, автопродление |
| Network | Единая изолированная Docker-сеть, `ports:` только у reverse-proxy |
| Secrets | `.env.production` вне git, права 600, зашифрованная резервная копия |
| File upload | MIME + размер + расширение валидируются в `top-api` до отправки в MinIO; ClamAV — рекомендован сразу, недорого по ресурсам, закрывает риск заражённого файла от поставщика |
| Rate limiting | Traefik middleware на `/auth/*` и `/portal/*` + NestJS guard |
| Tenant isolation | JWT → `organizationId` → `TenantGuard` → Prisma extension → DB query → storage prefix (п.15, без изменений) — обязательный CI-тест "Tenant A не видит Tenant B" на каждый новый модуль, блокирующий merge |
| Supplier Portal | См. отдельный раздел ниже (п.14) |
| AI | См. раздел "AI guardrails" (п.11) |

---

## G. Cloud Migration Architecture

Без изменений по существу (п.2):

```text
UGREEN DXP4800 Plus  →  VPS  →  Cloud (managed Postgres/Redis/S3)
```

Что гарантирует нулевой рефакторинг бизнес-логики:
- Postgres — стандартный, без NAS-специфичных расширений.
- MinIO — говорим только через S3 API; endpoint/ключи из ENV.
- Redis — стандартный протокол.
- Все контейнеры (`web`/`api`/`worker`) — **stateless**, вся persistence в Postgres/Redis/MinIO, не в файловой системе контейнера.
- Domain/secrets — из `.env`, не хардкожены.

Миграция = замена `docker-compose.prod.yml` на deployment-манифест новой платформы (или тот же Compose на новом хосте) + смена значений ENV + restore из последнего backup + DNS cutover. UGREEN после миграции переходит в роль backup/DR/archive узла — уже зафиксировано ранее, не меняется.

---

## H. Resource Estimate

| Container | CPU | RAM | Storage growth | Persistent Volume | Network | Dependencies | Backup |
|---|---:|---:|---|---|---|---|---|
| top-reverse-proxy | 0.3 | 128MB | минимальный (certs) | `proxy_certs` (NVMe) | 80/443 публично, остальное internal | — | не требуется (переиздаётся) |
| top-web | 0.5 | 512MB | 0 (stateless) | — | internal only | top-api | не требуется |
| top-api | 1.0 | 1GB | 0 (stateless) | — | internal only | postgres, redis, minio | не требуется |
| top-worker | 0.7 | 768MB | минимальный (tmp scratch) | — | internal + исходящий к Anthropic API | postgres, redis, minio | не требуется |
| top-postgres | 1.5 | 2–4GB | растёт с данными (~единицы GB/год на пилотном объёме) | `postgres_data` (NVMe) | internal only | — | ежедневно, критично |
| top-redis | 0.3 | 256MB | минимальный (AOF) | `redis_data` (NVMe) | internal only | — | не критично |
| top-minio | 0.5 | 512MB | растёт с документами (десятки–сотни GB/год) | `minio_data` (SATA) | internal only | — | ежедневно, критично |
| top-backup | 0.3 (burst) | 256MB | = объём retention | `backup_data` (SATA) | internal + исходящий (если offsite target настроен) | postgres, minio | сам является backup-слоем |
| **Итого** | **~5.1 vCPU** | **~5.4–7.4 GB** | NVMe: десятки GB / SATA: сотни GB, растёт | — | — | — | — |

DXP4800 Plus: 5 ядер/6 потоков, RAM расширяема до 64GB. Итоговый footprint контейнеров укладывается в железо **при условии установленной RAM от ~16–32GB** — при базовой конфигурации (часто 8GB на старте) рекомендую апгрейд до продакшена. Это по-прежнему открытый вопрос факта, не архитектуры (см. ниже).

---

## Product Master extensibility (п.6)

MVP: `PurchaseRequestItem { itemName, description, quantity, unit, technicalSpec }` — свободный текст, без изменений. Путь добавления Product Master в Phase 2 **без переписывания Purchase Request**:

```prisma
// Phase 2, чисто аддитивная миграция:
model Product {
  id             String @id @default(uuid())
  organizationId String
  sku            String?
  name           String
  aliases        String[]
  categoryId     String?
  unit           String
  // ...
}

model PurchaseRequestItem {
  // существующие поля не трогаем
  productId String?      // nullable FK — опционально линкуется к Product
  product   Product? @relation(fields: [productId], references: [id])
}
```

`productId` — nullable с самого начала архитектурно допустим (у нас уже denormalized `itemName`/`unit` как источник истины на уровне item), поэтому добавление FK — `ALTER TABLE ADD COLUMN` без backfill-обязательства, старые записи остаются валидными с `productId = NULL`. Это и есть "не блокировать" из вашего требования — конкретный, проверяемый путь, а не общая декларация.

## AI extensibility (п.7) — без изменений

`AIConversation`/`AIMessage`/`AIToolCall` не создаются в MVP. Когда Ask TOP AI перейдёт в разработку — это новые таблицы + новые read-only tools в `packages/ai/tools/`, использующие тот же `AIProvider` и тот же tool-layer (`searchSuppliers`, `getPriceHistory` и т.д. уже перечислены в исходном видении) — не новый AI-слой с нуля.

## OCR abstraction (п.8)

Добавляю интерфейс, который в MVP имеет единственную реализацию (делегирование в vision-LLM), но открыт для подключения специализированного OCR без изменения вызывающего кода:

```typescript
// packages/ai/src/ocr-provider.interface.ts
interface OCRProvider {
  extractText(document: Buffer, mimeType: string): Promise<{
    text: string;
    pages?: { pageNumber: number; text: string }[];
    confidence?: number;
  }>;
}

// packages/ai/src/providers/vision-llm-ocr.provider.ts  ← MVP: единственная реализация
// packages/ai/src/providers/tesseract-ocr.provider.ts   ← Phase 2, если vision LLM недостаточно
// packages/ai/src/providers/paddle-ocr.provider.ts       ← Phase 2, опционально
```

В MVP `QuoteExtractionService` вообще не вызывает `OCRProvider` напрямую — он передаёт документ сразу в `AIProvider.extract()` (vision-LLM делает OCR+извлечение одним проходом, как решили ранее). `OCRProvider` — заготовленная точка расширения на случай, если реальные сканы пилотных клиентов покажут, что двухэтапный pipeline (OCR → LLM на чистом тексте) даёт точность выше, чем прямой vision-проход. Никакой отдельный `top-ocr` контейнер в MVP не поднимается — согласовано в п.8.

## AI provider (п.9) — без изменений

`AIProvider { chat(), extract(), classify() }`, primary implementation — `AnthropicProvider`. `OpenAIProvider`/`OllamaProvider` — те же интерфейсы, добавляются как новые классы, business logic (`ai.orchestrator.ts`, tools) их не различает.

## AI cost logging (п.10) — поля зафиксированы точно

Каждый вызов `AIProvider` логируется структурированной записью (лог, не отдельная таблица с лимитами — она Phase 2):

```typescript
interface AIUsageLogEntry {
  organizationId: string;
  userId: string;
  operation: "extract_quote" | "generate_recommendation" | string;
  provider: "anthropic" | "openai" | string;
  model: string;
  inputHash: string;      // sha256 документа/промпта — тот же hash, что используется для extraction cache
  tokens: { input: number; output: number };
  estimatedCost: number;  // в USD, по прайсу provider на момент вызова
  timestamp: string;      // ISO 8601
}
```

## AI guardrails (п.11) — enforcement, не только политика

AI-модуль (`ai.service.ts`, tools) **физически не имеет write-доступа** к: цене (`QuoteItem.unitPrice` меняется пользователем через `PATCH /quotes/:id`, не AI-вызовом), количеству, VAT, валюте, статусу PO, выбору поставщика как финальному решению. AI пишет только в:
- `AIExtraction` (draft-предложение значений с confidence — не сами Quote-поля напрямую, кроме автозаполнения при high confidence, которое пользователь видит и может исправить до Verify);
- `Recommendation` (новая версия, не перезаписывает предыдущую, не имеет эффекта, пока пользователь не нажмёт Approve).

Ни один AI tool не вызывает `purchase-orders.service.create()` или `approvals.service.approve()` — этих методов просто нет в списке доступных AI tools (`packages/ai/tools/`), это ограничение на уровне того, какие функции вообще передаются модели как tools, а не проверка "не делай этого" в промпте.

## Currency & Tax readiness (п.13)

`currency` — свободная строка (ISO 4217 код), не enum, не ограничена тремя значениями — организация может использовать любую из UZS/USD/EUR/RUB/CNY/TRY (или другую) без миграции схемы. `TaxRule` — уже конфигурируемая таблица (`taxType`, `rate`, `effectiveFrom/To`, per-organization), НДС нигде не захардкожен в бизнес-логике. Didox/E-IMZO/SAP Business One — подтверждено, Phase 2, не блокируют MVP.

## Supplier Portal security (п.14) — без изменений, подтверждаю явно

`RFQSupplier.portalToken` — short-lived signed JWT, `tokenExpiresAt` = RFQ deadline + буфер; scope = конкретная запись `RFQSupplier` (один RFQ, один поставщик), не выдаёт доступ ни к другим RFQ, ни к другим поставщикам. После `Submit Quote` → `RFQSupplierStatus.SUBMITTED`, повторный POST на тот же токен отклоняется (read-only). Rate limiting — на уровне Traefik middleware для `/portal/*`.

---

## M0 Definition of Done (п.16)

M0 считается завершённым, когда выполнены все 9 пунктов — это чеклист, не описание:

- [ ] `docker-compose.yml` + `docker-compose.prod.yml` (+ `staging`) в репозитории, проходят `docker compose config` без ошибок
- [ ] Healthcheck определён и зелёный для каждого из 8 сервисов (раздел B.2)
- [ ] Persistent volumes смонтированы на явные host-пути NVMe/SATA (раздел D), не Docker default location
- [ ] Network isolation подтверждена: `docker compose ps` показывает `ports` только у `reverse-proxy`
- [ ] `.env.development.example` / `.env.staging.example` / `.env.production.example` в репозитории, реальные `.env.*` — вне git
- [ ] Первая Prisma-миграция применяется (`prisma migrate deploy`) к чистой БД в контейнере без ручных правок
- [ ] `backup.sh` запускается вручную и производит валидный дамп Postgres + snapshot MinIO в `backup_data`
- [ ] **Restore test пройден** — см. процедуру ниже (это отдельный, обязательный пункт, не просто "скрипт существует")
- [ ] Базовый мониторинг/логирование: `top-status` (Uptime Kuma) показывает все 8 сервисов зелёными; структурированные логи `api`/`worker` пишутся в stdout (Docker log driver), доступны через `docker compose logs`

## Restore Test Procedure (п.17) — обязателен до go-live, не опционален

```text
1. Create test database (отдельная БД/schema, не production)
2. Заполнить тестовыми данными (seed)
3. Выполнить backup.sh → получить дамп в backup_data
4. Удалить test database полностью
5. Выполнить restore.sh из полученного дампа
6. Verify: количество строк по ключевым таблицам совпадает с шагом 2,
   выборочная сверка значений (не просто "restore не упал с ошибкой")
```

То же самое — для MinIO: создать тестовый bucket/prefix с несколькими файлами → sync в backup → удалить оригинал → restore из backup → сверить checksum (sha256) файлов до/после, не только имена. Результат восстановления и sha256-сверка — часть чеклиста M0, а не отдельная задача "когда-нибудь".

---

## Всё ещё требует вашего решения (факты, не архитектура — без ответа M0a не закроется)

Эти пять пунктов поднимались и в прошлом документе и пока не получили ответа — без них Definition of Done из раздела выше не может быть закрыт целиком (пункты про network/domain/backup target):

1. Сколько RAM физически установлено на DXP4800 Plus сейчас (расчёт в разделе H предполагает от 16–32GB для комфортного запаса).
2. Offsite backup destination — S3-совместимое холодное хранилище (Backblaze B2/Wasabi) или второй физический носитель/локация.
3. Домен и DNS-провайдер (для `WEB_DOMAIN`/`API_DOMAIN` и способа получения TLS-сертификата).
4. Статический внешний IP или нужен DDNS-клиент.
5. Подтверждение, что исходящий HTTPS с NAS до Anthropic API ничем не блокируется на роутере/провайдере.

Дальше не иду, пока вы явно не подтвердите этот документ (раздел A–H) целиком — как и просит п.18.
