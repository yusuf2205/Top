# TOP Procurement

AI-платформа управления закупками. Этот README — практическое руководство по репозиторию; архитектурные решения и почему они такие — в:

- [`TOP Procurement.md`](TOP%20Procurement.md) — исходное продуктовое видение
- [`TOP Procurement — CTO Decision Lock.md`](TOP%20Procurement%20—%20CTO%20Decision%20Lock.md) — зафиксированный MVP-скоуп
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — software-архитектура, ERD, database schema, API, RBAC, screen map
- [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) — первая версия infrastructure-архитектуры (NAS)
- [`FINAL-INFRASTRUCTURE-ARCHITECTURE.md`](FINAL-INFRASTRUCTURE-ARCHITECTURE.md) — **финальная**, подтверждённая infrastructure-архитектура (A–H) — этот репозиторий реализует именно её

Статус: **M0 — Infrastructure Bootstrap — завершён и проверен на реальном UGREEN DXP4800 Plus.** Все 7 сервисов (`web`, `api`, `worker`, `postgres`, `redis`, `minio`, `reverse-proxy`) подняты и healthy; миграция БД применена; backup и restore-test пройдены end-to-end.

---

## Что сделано и реально проверено на NAS

Не просто написано — задеплоено на `192.168.1.105` (dockerized), собрано, прогнано:

- Полный стек (`docker compose up`) — **все 7 контейнеров healthy**, устойчиво (проверено спустя 15+ минут работы)
- Все образы (`web`/`api`/`worker`/`backup`) собираются с нуля через `docker compose build` — multi-stage turborepo+pnpm паттерн
- Prisma-миграция (`20260913235443_init`) применена к живому Postgres — все 29 таблиц созданы
- `api`'s `/health` подтверждает реальную connectivity к Postgres (`{"status":"ok","checks":{"database":"ok"}}`)
- `backup.sh` — реальный `pg_dump` + mirror бакета MinIO
- `restore-test.sh` — полный цикл (backup → restore в чистую БД → сверка row count) — **PASS**
- `retention.sh` — грандфазер-политика реально удаляет старые бэкапы (проверено на 8 реальных бэкапах)

## Баги, найденные и исправленные только благодаря реальному деплою

Ничего из этого не ловилось локальным typecheck/build — вот что стоило живого прогона на NAS:

1. `worker` healthcheck без префикса `CMD` — весь compose-файл отклонялся
2. `minio/minio` больше не существует на Docker Hub — MinIO перенесли образы на `quay.io/minio/minio`
3. `turbo prune` не подтягивает `tsconfig.base.json` (referenced только через TS `extends`, не через package.json) — ломало сборку `worker`
4. `@prisma/client`'s postinstall не находит схему в нестандартном месте и молча пропускает генерацию — нужен явный `prisma generate` (теперь часть `@top/database`'s `build`-скрипта)
5. Внутренние пакеты (`@top/config` и т.д.) указывали `main` на `.ts`-исходник — работает для Next.js, но не для скомпилированного NestJS-рантайма (`Cannot find module`). Дал всем реальный `tsc`-build
6. pnpm's изолированный `node_modules`: прямые зависимости каждого пакета (`reflect-metadata`, `bullmq`...) не копировались в runner-образ
7. Prisma engine собран под OpenSSL 1.1, которого нет в `node:22-alpine` — нужен `apk add openssl`
8. Docker автоматически прописывает `HOSTNAME=<container id>`; Next.js standalone-сервер биндится на него вместо `0.0.0.0`
9. `wget http://localhost:...` внутри контейнера резолвит `::1` (IPv6) первым — сервер слушает только IPv4 → healthcheck false-negative. Фикс — явный `127.0.0.1`
10. MinIO's `mc` client (`dl.min.io`) — тоже мёртвая ссылка, как и Docker Hub образ. Заменено на `rclone` (уже был в образе)
11. `restore-test.sh` пытался `CREATE DATABASE ... TEMPLATE <live db>` — Postgres это запрещает, пока есть активные подключения (у `api` они всегда есть). Переписано на реалистичный сценарий: backup → restore в новую БД
12. `retention.sh` использовал `find -printf`, не поддерживаемый busybox — retention тихо ничего не делал

Все 12 — отдельные коммиты с описанием причины, история в `git log`.

## Открытие про сам NAS

DXP4800 Plus — **не выделенный сервер под TOP Procurement**, это уже активно используемый домашний/офисный сервер: на нём крутится ~20 контейнеров (Home Assistant, n8n, Nextcloud, ownCloud, Mattermost, Rocket.Chat, **ваш собственный Gitea** — то есть `git.mygithub.uz` физически живёт на этом же NAS, Ollama, WordPress и др.). Из-за этого:

- порт `3000` уже занят Gitea → TOP использует **только base `docker-compose.yml`** (без `docker-compose.override.yml`, который публикует порты на хост) для этого прогона — никаких конфликтов
- `/volume1` — единственный пул данных (bcache: SSD-кэш поверх HDD, не отдельные NVMe/SATA пути, как предполагалось в FINAL-INFRASTRUCTURE-ARCHITECTURE.md §D) — репозиторий сейчас лежит в `/volume1/docker/top/app`
- RAM: ~62GiB, ~51GiB свободно на момент проверки — закрывает Open Decision #1 с запасом

---

## Быстрый старт (локально, без Docker — для итерации на коде)

```bash
pnpm install
cp .env.development.example .env

docker compose up postgres redis minio
pnpm db:migrate:deploy
pnpm db:generate

pnpm dev   # turbo dev: web (:3000), api (:4000), worker
```

## Полный стек в Docker (проверено на NAS)

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps   # все 7 должны стать healthy
```

Для прямого доступа с хоста (curl/браузер на localhost) добавьте `docker-compose.override.yml` — но проверьте сначала, не заняты ли порты 3000/4000/5432/6379/9000/9001 чем-то другим на этой машине (как оказалось с Gitea на NAS).

## Staging / Production

```bash
cp .env.staging.example .env.staging
docker compose -p top-procurement-staging --env-file .env.staging \
  -f docker-compose.yml -f docker-compose.staging.yml up -d --build

cp .env.production.example .env.production
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Перед первым production-деплоем:

```bash
cp infrastructure/traefik/dynamic/middlewares.secrets.yml.example \
   infrastructure/traefik/dynamic/middlewares.secrets.yml
# сгенерировать реальный bcrypt-хэш — инструкция внутри файла
```

## Backup / Restore

```bash
docker compose -f docker-compose.yml run --rm backup /backup/backup.sh
docker compose -f docker-compose.yml run --rm backup /backup/restore-test.sh   # ежемесячно + перед go-live
docker compose -f docker-compose.yml run --rm backup /backup/restore.sh <timestamp> [target_db] [target_bucket]
```

---

## M0 Definition of Done — статус

- [x] `docker-compose.yml` + `.prod.yml` + `.staging.yml` — валидны, реально запускаются
- [x] Healthcheck на каждом из 7 сервисов — **все зелёные на реальном железе**
- [x] Network isolation — только `reverse-proxy` публикует порты вне dev-override
- [x] `.env.*.example` в репозитории, реальные `.env*` — вне git
- [x] Первая Prisma-миграция сгенерирована **и применена** к живой БД
- [x] `backup.sh` запущен и произвёл валидный дамп + mirror MinIO
- [x] **Restore test пройден** — PASS
- [ ] Persistent volumes на явных host-путях — сейчас именованные Docker volumes (стандартный Docker storage location на `/volume1`); explicit bind-mount пути на конкретные под-пути `/volume1/docker/top/...` — минорный докрут, не блокирует работу
- [ ] `top-status` (Uptime Kuma) — не добавлен в compose в этом проходе

## Всё ещё требует вашего решения

1. ~~Сколько RAM на DXP4800 Plus~~ — **закрыто**: ~62GiB
2. Offsite backup destination (Backblaze B2/Wasabi/второй физический носитель) — сейчас `BACKUP_TARGETS=local` (бэкапы лежат в `/volume1/docker/top/backup_data`, тот же физический пул, что и продакшен-данные — это разумно только как первый уровень, не полноценный 3-2-1)
3. Домен и DNS-провайдер (нужен для staging/production — dev/тестовый прогон их не требовал)
4. Статический внешний IP или DDNS
5. Исходящий HTTPS с NAS до Anthropic API — не проверялось в этом проходе

---

## M1 — Auth + Organization + RBAC

Реализовано поверх зафиксированной архитектуры (ARCHITECTURE.md §3.2/§6): **enum-based RBAC** (6 ролей на `User`, без отдельных таблиц Role/Permission — сознательное решение, не упрощение "по недосмотру"), **один User = одна Organization** (без Membership/мульти-орг). Self-service регистрация (`POST /auth/register`) добавлена поверх этой модели как обоснованное расширение — детали и весь traceability между исходным промптом задачи и итоговыми решениями см. в M1 IMPLEMENTATION REPORT (последнее сообщение ассистента в этой ветке разработки).

**Что реализовано:**
- Auth: register / login / logout / refresh / me — access token (JWT, 15 мин, in-memory на фронте) + refresh token (opaque, hashed, httpOnly cookie, ротация с обнаружением повторного использования)
- Пароли — `crypto.scrypt` (Node built-in), не argon2 — сознательный выбор, чтобы не тащить нативный бинарник в Alpine-образ (см. `apps/api/src/common/auth/password.service.ts`)
- Tenant isolation — `TenantContextInterceptor` оборачивает каждый authenticated-запрос в `runWithTenantContext()`, дальше работает уже существующий с M0 Prisma Client Extension
- RBAC — `JwtAuthGuard` → `TenantGuard` → `RolesGuard`, `@Roles()`/`@Public()` декораторы
- Organization: `GET/PATCH /organizations/current`
- Members: список, приглашение по email+роли (ссылка отдаётся админу вручную — **email ещё не подключён**, SMTP не настроен), accept по одноразовому токену, смена роли, soft-remove — с защитой "нельзя разжаловать/удалить последнего Admin"
- Audit log на все ключевые события (USER_LOGIN, INVITATION_CREATED, MEMBER_ROLE_CHANGED и т.д.), без утечки паролей/токенов в лог
- Frontend: `/login`, `/register`, `/dashboard`, `/settings/organization`, `/settings/members`, `/invite/:token`

**Тесты:**
```bash
# Unit (без БД, работают где угодно):
pnpm --filter @top/api test -- --testPathPattern='\.spec\.ts$' --testPathIgnorePatterns=test/

# Integration + security (требуют реальный Postgres — поднятый docker-compose `postgres`):
DATABASE_URL=postgresql://top:...@localhost:5432/top_procurement_test pnpm --filter @top/api test
```
Security-тест "Organization A никогда не видит данные Organization B" — `apps/api/test/members-invitations.e2e.spec.ts`, покрывает участников, приглашения и попытку подставить чужой `organizationId`.

**Известные ограничения M1** (сознательно вне скоупа, не забыто):
- Email-доставка приглашений не реализована (SMTP опционален и не настроен) — ссылка отдаётся администратору в ответе API
- Password reset (`/auth/forgot-password`) не реализован — не было явного требования, добавляется по запросу
- ESLint не настроен репозиторий-wide (пробел ещё с M0, не M1)

## Дальше

1. Ответы на 5 пунктов выше → `.env.production` → первый staging/production деплой с Traefik+TLS
2. Явные bind-mount пути под `/volume1/docker/top/{postgres,minio,backups}` вместо анонимных volumes
3. M2+ — Purchase Request / Supplier / RFQ / Quote и далее по core workflow, см. [ARCHITECTURE.md §11](ARCHITECTURE.md)
