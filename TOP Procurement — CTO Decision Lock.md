# CTO DECISION LOCK — TOP PROCUREMENT

Ты правильно выявил две проблемы в исходной спецификации.

Зафиксируй следующие архитектурные решения как обязательные для проекта.

---

# 1. MVP DEFINITION

Мы не считаем все функции из первоначальной секции 123 обязательными для первого релиза.

Первый релиз называется:

**TOP Procurement MVP v1**

Его задача — доказать главную продуктовую гипотезу:

> TOP Procurement позволяет закупщику значительно быстрее пройти путь от потребности до выбора поставщика и создания Purchase Order.

---

# 2. MVP CORE WORKFLOW

Главный workflow MVP:

```text
Purchase Request
        ↓
Supplier Selection
        ↓
RFQ
        ↓
Supplier Portal
        ↓
Quote
        ↓
AI Extraction
        ↓
Quote Normalization
        ↓
Quote Comparison
        ↓
AI Recommendation
        ↓
Human Approval
        ↓
Purchase Order
```

Если функция не помогает этому workflow — она не является обязательной для MVP.

---

# 3. MVP MODULES

В MVP v1 реализовать только:

## Authentication

- login;
- logout;
- password reset;
- session management.

## Multi-Tenant Organization

- organization;
- users;
- tenant isolation.

## RBAC

Минимальные роли:

- Admin;
- Procurement Manager;
- Procurement Specialist;
- Approver;
- Employee;
- Supplier.

Не создавать сложную permission system без необходимости.

---

# 4. PURCHASE REQUEST

Реализовать:

- создание;
- редактирование;
- отправку;
- approval;
- rejection;
- comments;
- attachments.

Минимальные поля:

```text
request_number
requester
department
item
description
quantity
unit
required_date
estimated_budget
currency
priority
attachments
status
```

AI-assisted request creation можно включить, но это не должно блокировать обычное ручное создание.

---

# 5. SUPPLIER MANAGEMENT

MVP:

- supplier CRUD;
- contacts;
- categories;
- basic rating;
- documents;
- active/inactive.

Не реализовывать пока сложную supplier risk engine.

---

# 6. RFQ

Закупщик должен иметь возможность:

1. открыть Purchase Request;
2. выбрать suppliers;
3. создать RFQ;
4. указать deadline;
5. отправить RFQ.

RFQ должен иметь:

- number;
- items;
- quantities;
- technical specification;
- deadline;
- suppliers;
- status.

---

# 7. SUPPLIER PORTAL

Supplier должен получить простую web-страницу по защищённой ссылке.

Поставщик видит:

```text
RFQ
Items
Quantity
Specification
Deadline
```

И может указать:

```text
Price
Currency
VAT
Delivery Time
Delivery Cost
Payment Terms
Warranty
Comment
Attachment
```

После Submit Quote закупщик должен увидеть ответ в системе.

---

# 8. QUOTE MANAGEMENT

Создать нормализованную структуру Quote.

Каждое предложение должно хранить:

```text
supplier
item
quantity
unit_price
currency
vat
delivery_cost
lead_time
payment_terms
warranty
notes
attachments
```

---

# 9. AI DOCUMENT EXTRACTION

Это одна из главных AI-функций MVP.

Поставщик может загрузить:

- PDF;
- Excel;
- image.

AI извлекает:

```text
Supplier
Product
SKU
Quantity
Price
Currency
VAT
Delivery
Lead Time
Payment Terms
Warranty
```

Каждое извлечённое поле должно иметь confidence.

Например:

```text
Price: 18,500 UZS
Confidence: 97%
```

Если confidence ниже configurable threshold:

```text
Needs Review
```

Пользователь должен иметь возможность исправить значение.

---

# 10. QUOTE NORMALIZATION

Критически важно:

AI не должен просто извлекать текст.

Он должен привести разные предложения к единой структуре.

Например:

Supplier A:

```text
18,500 UZS
VAT included
Delivery included
```

Supplier B:

```text
17,000 UZS
VAT excluded
Delivery 500,000 UZS
```

Система должна привести их к comparable values.

---

# 11. QUOTE COMPARISON

Главный экран MVP.

Показывать:

| Parameter | Supplier A | Supplier B | Supplier C |
|---|---:|---:|---:|
| Unit Price | | | |
| VAT | | | |
| Delivery | | | |
| Total Cost | | | |
| Lead Time | | | |
| Payment | | | |
| Warranty | | | |
| Supplier Score | | | |

Добавить:

- sorting;
- highlighting best values;
- filters;
- export.

---

# 12. TOTAL COST

Для MVP использовать только:

```text
Product Price
+
VAT
+
Delivery
=
Total Cost
```

Не реализовывать пока:

- financing cost;
- insurance;
- risk cost;
- customs;
- bank fees.

Оставить архитектурную возможность расширения.

---

# 13. AI RECOMMENDATION

После comparison AI должен дать recommendation.

Например:

```text
Recommended Supplier:
ABC LLC

Why:

1. Lowest total cost
2. Delivery within required date
3. Good supplier history
4. Competitive payment terms

Estimated saving:
8,500,000 UZS
```

AI не должен автоматически выбирать поставщика.

Всегда:

```text
AI Recommendation
        ↓
Human Decision
```

---

# 14. APPROVAL

MVP approval должен быть простым.

Например:

```text
Purchase < 50m UZS
→ Procurement Manager

Purchase >= 50m UZS
→ Director
```

Но threshold должен находиться в configuration, а не быть hardcoded.

---

# 15. PURCHASE ORDER

После approval закупщик может создать PO.

PO:

```text
Supplier
Items
Quantity
Price
VAT
Delivery
Payment Terms
Expected Delivery
```

Статусы:

```text
Draft
Pending Approval
Approved
Sent
Confirmed
Cancelled
```

---

# 16. MVP DASHBOARD

Не строить огромную BI-систему.

Только:

```text
Open Requests
Active RFQs
Quotes Received
Pending Approvals
Purchase Orders
Potential Savings
```

И базовый график:

```text
Procurement by Month
```

---

# 17. EXPLICITLY OUT OF MVP

Следующие функции НЕ должны блокировать MVP:

```text
SAP Business One
Didox
E-IMZO
Invoice
3-Way Match
Inventory
BOM
Forecasting
Advanced Budget
Contracts
Advanced Risk
Supplier Marketplace
Mobile Native App
WhatsApp
Electronic Auctions
Advanced Procurement Analytics
```

Они переходят в Phase 2 / Phase 3.

---

# 18. MONOREPO DECISION

Использовать:

```text
pnpm
+
Turborepo
+
TypeScript
```

Структура:

```text
apps/
  web/
  api/
  worker/

packages/
  ui/
  database/
  types/
  validation/
  config/
  ai/
```

---

# 19. FRONTEND

Использовать:

```text
Next.js
React
TypeScript
```

UI должен быть:

- professional;
- modern;
- minimal;
- enterprise;
- data-oriented.

Не делать cartoon-style UI.

---

# 20. BACKEND

Использовать:

```text
NestJS
TypeScript
PostgreSQL
Prisma
```

Архитектура:

```text
modules/
  auth/
  organizations/
  users/
  suppliers/
  products/
  purchase-requests/
  rfqs/
  quotes/
  comparisons/
  recommendations/
  approvals/
  purchase-orders/
  notifications/
  ai/
```

---

# 21. AI ARCHITECTURE DECISION

На MVP AI НЕ выносить в отдельный microservice.

AI реализовать как отдельный NestJS module:

```text
src/modules/ai/

ai.module.ts
ai.service.ts
ai.orchestrator.ts

providers/
  openai.provider.ts
  anthropic.provider.ts

tools/
  supplier-search.tool.ts
  quote-analysis.tool.ts
  recommendation.tool.ts
  price-history.tool.ts

prompts/
```

Создать abstraction:

```typescript
interface AIProvider {
  chat(): Promise<AIResponse>;
  extract(): Promise<ExtractionResult>;
  classify(): Promise<ClassificationResult>;
}
```

Это позволит менять LLM provider без переписывания бизнес-логики.

---

# 22. WHEN TO USE WORKER

Heavy operations должны выполняться asynchronously.

Например:

```text
PDF upload
↓
Queue
↓
Worker
↓
OCR
↓
AI extraction
↓
Database
↓
Notification
```

Для этого использовать:

```text
Redis
+
BullMQ
```

Worker находится в:

```text
apps/worker
```

---

# 23. DO NOT OVERENGINEER

Не использовать микросервисы без доказанной необходимости.

Не использовать Kubernetes для MVP.

Не создавать:

- service mesh;
- event bus infrastructure;
- distributed tracing everywhere;
- complex CQRS;
- separate AI cluster.

Сначала modular monolith.

Архитектура должна позволять дальнейшее разделение сервисов.

---

# 24. MODULAR MONOLITH

Главная архитектура MVP:

```text
                 ┌──────────────┐
                 │   Next.js    │
                 │     Web      │
                 └──────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │    NestJS     │
                │      API      │
                └───────┬───────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
 Procurement           AI            Auth/RBAC
 Modules             Module           Modules
       │                │
       └────────┬───────┘
                ▼
          PostgreSQL
                │
                ▼
             Redis
                │
                ▼
             Worker
```

---

# 25. DATABASE

Использовать:

```text
PostgreSQL
+
Prisma
```

Все tenant-owned tables должны иметь:

```text
organization_id
```

Tenant isolation обязательно тестировать.

---

# 26. FINANCIAL DATA

Денежные значения:

**NUMERIC/DECIMAL**

Никогда:

```text
float
```

Для:

- prices;
- VAT;
- totals;
- savings;
- budgets.

---

# 27. CURRENCY

MVP:

- UZS;
- USD;
- EUR.

Но currency system должен быть extensible.

---

# 28. TAX

Создать configurable TaxRule.

Не hardcode:

```text
VAT = 12
```

в бизнес-логике.

---

# 29. AI HUMAN-IN-THE-LOOP

Все AI-generated results:

```text
Draft
↓
Review
↓
Confirm
```

Особенно:

- prices;
- supplier;
- quote;
- recommendation;
- PO.

---

# 30. AI AUDIT

Хранить:

```text
AI request
AI response
model
timestamp
user
organization
source document
confidence
```

Не хранить секреты или unnecessary sensitive data.

---

# 31. SECURITY PRIORITY

Приоритет:

```text
Tenant isolation
>
Authorization
>
Financial correctness
>
Auditability
>
AI functionality
>
UI polish
```

---

# 32. PHASE 2

После успешного MVP добавить:

```text
Invoice
3-Way Match
Contracts
Budget
Advanced Supplier Score
Supplier Risk
Price Intelligence
Telegram
Excel Advanced Import
SAP Business One
Didox
E-IMZO
Inventory Integration
```

---

# 33. PHASE 3

После validation:

```text
AI Agents
Demand Forecasting
BOM
Supplier Marketplace
Electronic Auctions
Advanced Analytics
Mobile Apps
Regional Expansion
```

---

# 34. CTO DECISION RULE

Если в процессе разработки появляется новая функция, сначала классифицируй её:

```text
MVP
Phase 2
Phase 3
Not needed
```

Не добавляй новые функции автоматически.

Каждая новая функция должна отвечать:

1. Какую проблему закупщика она решает?
2. Как часто эта проблема возникает?
3. Какой measurable business value?
4. Можно ли решить её проще?
5. Блокирует ли она MVP?

---

# 35. FIRST IMPLEMENTATION MILESTONE

Теперь не генерируй весь проект сразу.

Сначала подготовь:

## 1. Final Architecture

## 2. Final MVP Scope

## 3. Domain Model

## 4. ERD

## 5. Database Schema

## 6. RBAC Matrix

## 7. API Specification

## 8. Frontend Screen Map

## 9. AI Architecture

## 10. Folder Structure

## 11. Development Milestones

## 12. Risks

После этого остановись и жди следующего этапа.

Не переходи к массовой генерации production code, пока архитектурные решения не определены.