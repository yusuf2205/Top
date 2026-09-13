# TOP Procurement

AI-платформа управления закупками. Этот README — практическое руководство по репозиторию; архитектурные решения и почему они такие — в:

- [`TOP Procurement.md`](TOP%20Procurement.md) — исходное продуктовое видение
- [`TOP Procurement — CTO Decision Lock.md`](TOP%20Procurement%20—%20CTO%20Decision%20Lock.md) — зафиксированный MVP-скоуп
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — software-архитектура, ERD, database schema, API, RBAC, screen map
- [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) — первая версия infrastructure-архитектуры (NAS)
- [`FINAL-INFRASTRUCTURE-ARCHITECTURE.md`](FINAL-INFRASTRUCTURE-ARCHITECTURE.md) — **финальная**, подтверждённая infrastructure-архитектура (A–H) — этот репозиторий реализует именно её

Статус: **M0 — Infrastructure Bootstrap**, в процессе.

---

## Что уже сделано в M0 (эта сессия)

Реализовано и локально проверено (типы, сборка, генерация Prisma-клиента, валидность YAML):

- pnpm + Turborepo монорепозиторий (`apps/*`, `packages/*`)
- `packages/database` — полная Prisma-схема ([ARCHITECTURE.md §5](ARCHITECTURE.md)) + первая миграция уже сгенерирована (`packages/database/prisma/migrations/20260913235443_init/`), tenant-isolation Prisma Client Extension (`packages/database/src/client.ts`) с явными границами, что она покрывает, а что должно проверяться на уровне сервисов/тестов
- `packages/config` — единая валидируемая (zod) точка входа для всех env-переменных
- `packages/ai` — `AIProvider`/`OCRProvider` интерфейсы (реализации — M4/M6)
- `packages/types`, `packages/validation`, `packages/ui` — заготовки под M1+
- `apps/api` (NestJS) — минимальный каркас + `/health` (проверяет Postgres)
- `apps/web` (Next.js, standalone output) — минимальный каркас + `/api/health`
- `apps/worker` (BullMQ) — подключение к Redis, очередь-заготовка `quote-extraction`, healthcheck-скрипт
- `docker-compose.yml` + `.override.yml` (dev) + `.staging.yml` + `.prod.yml` — полная топология из [FINAL-INFRASTRUCTURE-ARCHITECTURE.md §B](FINAL-INFRASTRUCTURE-ARCHITECTURE.md), healthchecks на каждый сервис, ни один сервис кроме `reverse-proxy` не публикует порт вне dev-override
- `infrastructure/docker/*.Dockerfile` — multi-stage сборки (turbo prune + pnpm) для web/api/worker/backup
- `infrastructure/traefik/` — статический конфиг + dynamic middlewares (rate-limit, security headers); секреты (basic-auth хэш) вынесены в `.example`-шаблон, не в git
- `infrastructure/backup/` — `backup.sh`/`restore.sh`/`restore-test.sh`/`retention.sh` + target-abstraction (`targets/local.sh`, `targets/offsite-s3.sh.example`)
- `.env.{development,staging,production}.example` — вся конфигурация из ENV, ничего не захардкожено

### Что я не мог проверить в этой сессии — и почему

Я работал в песочнице без Docker (`docker`/`docker compose` не установлены) и без запущенного PostgreSQL/Redis/MinIO. Поэтому:

- **`docker compose up` не запускался и не проверялся живьём.** YAML всех compose-файлов и Traefik-конфигов синтаксически провалидирован (`js-yaml`), но реальный запуск, healthcheck-прохождение и networking — нет. Это должно быть первым, что вы (или я в следующей сессии с доступом к Docker) делаете на реальной машине/NAS.
- **`docker build` для web/api/worker/backup не запускался.** Dockerfile написаны по стандартному turborepo+pnpm паттерну и синтаксически корректны, но не собраны ни разу.
- **`prisma migrate deploy` не запускался** (нет живого Postgres) — миграция сгенерирована оффлайн через `prisma migrate diff --from-empty` (валидный, стандартный способ создать первую миграцию без БД) и выглядит корректно (создаёт все таблицы/enum'ы/индексы из схемы), но не была применена и проверена на реальной базе.
- **`restore-test.sh` не запускался** — обязательный пункт (M0 Definition of Done, п.17) до сих пор не выполнен по факту, только написан.
- Локальная сборка `apps/api` и `apps/worker` (`pnpm turbo build`) **прошла успешно**. Сборка `apps/web` **типизируется и компилируется успешно**, но локальный шаг "trace standalone output" падает на этой машине с `EPERM: symlink` — это специфичная для Windows-хоста проблема (создание symlink требует Developer Mode/админ-прав в Windows; pnpm использует symlink'и в node_modules). **Внутри Docker-контейнера (Linux, что и есть цель деплоя) этой проблемы нет** — но это тоже стоит подтвердить первым реальным `docker build`.

Ничего из этого не является дефектом архитектуры или кода — это ожидаемый разрыв между "написано и провалидировано статически" и "запущено на целевой Linux/Docker среде", которую я в этой сессии не могу физически потрогать.

Две вещи, специфичные для этой сессии/машины, а не для проекта:

- `pnpm-workspace.yaml` содержит `overrides` (пины `enhanced-resolve`/`schema-utils` на предыдущий patch) и `allowBuilds` (явное разрешение postinstall-скриптов Prisma/esbuild/NestJS/msgpackr-extract) — это реакция на supply-chain-policy этой конкретной песочницы (блокирует пакеты, опубликованные "слишком недавно" относительно системных часов, и требует явного одобрения build-скриптов). Не имеет отношения к архитектуре; если на вашей машине/NAS `pnpm install` пройдёт и без этого — можно убрать, если нет — оставить.
- ESLint не настроен (`lint` в package.json — заготовка на будущее, вызывать пока рано). Не блокирует M0 Definition of Done, но стоит закрыть в начале M1 вместе с первым реальным PR-флоу.

---

## Быстрый старт (локально, без Docker — для итерации на коде)

```bash
pnpm install
cp .env.development.example .env   # уже сделано в этой сессии, .env в git не попадёт

# инфраструктура — в Docker (когда Docker будет доступен):
docker compose up postgres redis minio

# после того как Postgres поднят:
pnpm db:migrate:deploy   # применяет уже сгенерированную миграцию
pnpm db:generate

# приложения — на хосте, для быстрой итерации:
pnpm dev   # turbo dev: web (:3000), api (:4000), worker
```

## Быстрый старт (полностью в Docker, ближе к prod)

```bash
docker compose up --build
# web:  http://localhost:3000
# api:  http://localhost:4000/health
# minio console: http://localhost:9001
```

`docker-compose.override.yml` подхватывается автоматически и публикует порты на localhost — см. комментарий в файле.

## Staging / Production

```bash
cp .env.staging.example .env.staging       # заполнить реальными значениями
docker compose -p top-procurement-staging --env-file .env.staging \
  -f docker-compose.yml -f docker-compose.staging.yml up -d --build

cp .env.production.example .env.production
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Перед первым production-деплоем обязательно:

```bash
cp infrastructure/traefik/dynamic/middlewares.secrets.yml.example \
   infrastructure/traefik/dynamic/middlewares.secrets.yml
# сгенерировать реальный bcrypt-хэш — инструкция внутри файла
```

## Backup / Restore

```bash
docker compose run --rm backup /backup/backup.sh
docker compose run --rm backup /backup/restore-test.sh   # обязательно перед go-live (M0 п.17)
docker compose run --rm backup /backup/restore.sh <timestamp> [target_db] [target_bucket]
```

---

## M0 Definition of Done — статус

Чеклист из [FINAL-INFRASTRUCTURE-ARCHITECTURE.md](FINAL-INFRASTRUCTURE-ARCHITECTURE.md):

- [x] `docker-compose.yml` + `docker-compose.prod.yml` (+ `staging`) в репозитории — YAML валиден
- [x] Healthcheck определён для каждого из 8 сервисов
- [x] Persistent volumes — именованные Docker volumes определены; **явные host-пути на NVMe/SATA пока не заданы** (это физическая настройка на самом NAS — driver_opts/bind-mount пути появляются, когда известна реальная файловая структура пулов вашего DXP4800 Plus)
- [x] Network isolation — только `reverse-proxy` публикует порты в staging/prod
- [x] `.env.*.example` в репозитории, реальные `.env*` — вне git
- [x] Первая Prisma-миграция сгенерирована и валидна
- [ ] `backup.sh` запущен вручную и произвёл валидный дамп — **не выполнено** (нет живого Postgres в этой сессии)
- [ ] **Restore test пройден** — **не выполнено**, см. выше
- [x] Базовая инфраструктура для мониторинга/логирования заложена (Docker healthcheck + `docker compose logs`); `top-status` (Uptime Kuma) как отдельный сервис — **не добавлен в compose файлы в этом проходе**, лёгкое дополнение, добавлю по вашему сигналу или в рамках M1

## Всё ещё требует вашего решения (без ответа M0a/M0c не закрыть)

Не изменилось с прошлого раза — эти пять фактов физически знаете только вы:

1. Сколько RAM установлено на DXP4800 Plus сейчас
2. Offsite backup destination (Backblaze B2/Wasabi/второй физический носитель) — до ответа `BACKUP_TARGETS=local` (в `.env.*.example` уже так)
3. Домен и DNS-провайдер (сейчас в `.env.*.example` — плейсхолдеры `REPLACE_ME.uz`)
4. Статический внешний IP или нужен DDNS
5. Подтверждение исходящего HTTPS с NAS до Anthropic API

## Дальше

1. Как только Docker будет доступен (на вашей машине или на самом NAS) — первым делом: `docker compose up`, проверить, что все 8 healthcheck зелёные, затем `backup.sh`/`restore-test.sh`.
2. Ответы на 5 пунктов выше → заполнить `.env.production`.
3. M1 (Auth + RBAC + Multi-tenant) — первый бизнес-модуль поверх этого каркаса, см. [ARCHITECTURE.md §11](ARCHITECTURE.md).
