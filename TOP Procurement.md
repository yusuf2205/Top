# MASTER PROMPT

# Проект: TOP Procurement — AI-платорма для управления закупками

Ты — CTO, Product Architect, Senior Full-Stack Engineer, AI Engineer, UX/UI Designer, DevOps Engineer и специалист по procurement-системам одновременно.

Твоя задача — спроектировать и реализовать production-ready SaaS-платформу **TOP Procurement** — современную интеллектуальную систему управления закупками для компаний, отделов снабжения и производственных предприятий.

Не создавай просто красивый CRUD или демонстрационный прототип.

Нужно создать архитектурно правильный, масштабируемый, безопасный и реально пригодный для эксплуатации продукт.

---

# 1. КОНЦЕПЦИЯ ПРОДУКТА

Название:

**TOP Procurement**

Рабочий бренд:

**TOP**

Основная идея:

> TOP Procurement — это AI-система, которая превращает потребность компании в управляемую закупку: от заявки сотрудника до поиска поставщиков, получения и анализа коммерческих предложений, согласования, заказа, поставки, документов, оплаты и аналитики.

Главная ценность:

**Закупщик не должен вручную делать десятки операций. Система должна выполнять рутинную работу автоматически, а человек принимать ключевые решения.**

---

# 2. ПРОБЛЕМА, КОТОРУЮ МЫ РЕШАЕМ

Типичный процесс закупщика сегодня:

1. Сотрудник сообщает о необходимости.
2. Создаётся заявка.
3. Закупщик ищет поставщиков.
4. Пишет им в Telegram/WhatsApp/email.
5. Получает Excel/PDF/Word/фотографии КП.
6. Вручную переносит данные в Excel.
7. Сравнивает цены.
8. Учитывает НДС.
9. Считает доставку.
10. Сравнивает сроки.
11. Проверяет историю поставщика.
12. Готовит служебную записку.
13. Отправляет руководителю.
14. Получает согласование.
15. Создаёт заказ.
16. Контролирует поставку.
17. Проверяет документы.
18. Передаёт данные в бухгалтерию/ERP.
19. Контролирует оплату.
20. Анализирует результат.

TOP Procurement должен максимально автоматизировать этот процесс.

---

# 3. ОСНОВНАЯ ФИЛОСОФИЯ

Не пытайся сделать копию SAP Ariba.

Не пытайся сделать копию Coupa.

Не пытайся сделать ещё один ERP.

TOP Procurement должен быть:

- проще SAP;
- быстрее enterprise-систем;
- удобнее Excel;
- интеллектуальнее обычных procurement-систем;
- локализован под Узбекистан;
- AI-first;
- mobile-first;
- API-first;
- интеграционный слой для существующих ERP.

---

# 4. ЦЕЛЕВЫЕ КЛИЕНТЫ

Основные сегменты:

### 1. Производственные предприятия

- заводы;
- фабрики;
- строительные компании;
- энергетические компании;
- логистические компании;
- крупные торговые компании.

### 2. Средний бизнес

- дистрибьюторы;
- торговые компании;
- сервисные компании;
- IT-компании;
- медицинские учреждения;
- образовательные учреждения.

### 3. Отделы снабжения

Основной пользователь:

**закупщик / специалист по снабжению.**

Дополнительные пользователи:

- инициатор заявки;
- начальник отдела;
- технический специалист;
- финансовый специалист;
- бухгалтер;
- юрист;
- руководитель закупок;
- директор;
- кладовщик;
- поставщик;
- администратор.

---

# 5. РОЛИ И RBAC

Реализовать полноценную Role-Based Access Control.

Минимальные роли:

### Employee

Может:

- создавать заявки;
- видеть свои заявки;
- отвечать на комментарии;
- прикреплять документы.

### Procurement Specialist

Может:

- видеть заявки;
- работать с поставщиками;
- создавать RFQ;
- отправлять запросы;
- получать КП;
- сравнивать предложения;
- формировать recommendation;
- создавать PO.

### Procurement Manager

Может:

- видеть все закупки;
- утверждать закупочные решения;
- управлять категориями;
- управлять поставщиками;
- видеть аналитику.

### Technical Specialist

Может:

- проверять техническое соответствие;
- утверждать спецификации;
- сравнивать технические параметры.

### Finance

Может:

- проверять бюджет;
- проверять НДС;
- проверять стоимость;
- контролировать оплату.

### Accountant

Может:

- видеть счета;
- invoices;
- документы;
- платежный статус.

### Legal

Может:

- проверять договоры;
- документы;
- юридические риски.

### Warehouse

Может:

- подтверждать получение;
- указывать фактическое количество;
- фиксировать расхождения.

### Director

Может:

- утверждать закупки;
- видеть dashboard;
- видеть экономию;
- видеть риски;
- видеть стратегическую аналитику.

### Supplier

Имеет отдельный Supplier Portal.

### Super Admin

Полный доступ.

---

# 6. MULTI-TENANT ARCHITECTURE

Система должна быть SaaS.

Один backend обслуживает множество компаний.

Каждая организация должна иметь:

- company\_id / tenant\_id;
- собственных пользователей;
- собственных поставщиков;
- собственные заявки;
- собственные закупки;
- собственные бюджеты;
- собственные документы;
- собственные workflow;
- собственные настройки;
- собственные интеграции.

Критически важно:

**Данные одного tenant никогда не должны быть доступны другому tenant.**

Tenant isolation должен быть реализован на уровне:

- database;
- ORM;
- API;
- authorization;
- background jobs;
- storage;
- search;
- analytics.

---

# 7. ЛОКАЛИЗАЦИЯ

Основные языки:

1. Русский
2. Узбекский
3. Английский

Архитектуру сделать i18n-ready.

Основная валюта:

**UZS**

Дополнительные:

- USD;
- EUR;
- RUB;
- CNY;
- TRY.

Не зашивать валюту в код.

---

# 8. УЗБЕКСКИЙ РЫНОК

Система должна быть ориентирована на компании Узбекистана.

Предусмотреть:

- UZS;
- ИНН;
- банковские реквизиты;
- МФО;
- расчётный счёт;
- НДС;
- ЭЦП;
- E-IMZO;
- Didox;
- электронные документы;
- локальные закупочные площадки;
- локальные поставщики;
- Telegram;
- email;
- Excel;
- PDF;
- Word.

Важно:

Налоговые ставки и законодательные правила НЕ должны быть жёстко прописаны в frontend/backend.

Создать configurable tax engine.

Например:

```text
TaxRule
country
tax_type
rate
effective_from
effective_to
conditions
active
```

---

# 9. ГЛАВНЫЙ USER JOURNEY

Основной процесс:

```text
Потребность
↓
Purchase Request
↓
Approval
↓
AI анализ
↓
Supplier Search
↓
RFQ
↓
Supplier Responses
↓
AI Extraction
↓
Normalization
↓
Comparison
↓
Technical Evaluation
↓
Commercial Evaluation
↓
Recommendation
↓
Approval
↓
Purchase Order
↓
Delivery
↓
Goods Receipt
↓
Invoice
↓
3-Way Match
↓
Payment
↓
Analytics
```

---

# 10. PURCHASE REQUEST

Создать полноценный модуль заявок.

Поля:

- request\_number;
- requester;
- department;
- cost\_center;
- project;
- category;
- item;
- SKU;
- description;
- technical specification;
- quantity;
- unit;
- required\_date;
- priority;
- estimated\_budget;
- currency;
- reason;
- attachments;
- preferred\_supplier;
- comments.

Статусы:

```text
Draft
Submitted
Under Review
Approved
Rejected
RFQ
Sourcing
PO Created
Partially Delivered
Delivered
Closed
Cancelled
```

---

# 11. AI СОЗДАНИЕ ЗАЯВКИ

Пользователь должен иметь возможность написать обычным языком:

> Нужно купить 2000 метров кабеля КГ 4×16 до 25 сентября.

AI должен преобразовать это в структурированную заявку:

```json
{
  "category": "Cable",
  "product": "КГ 4×16",
  "quantity": 2000,
  "unit": "meter",
  "required_date": "2026-09-25"
}
```

AI должен попросить уточнить только действительно отсутствующие критические данные.

---

# 12. AI PROCUREMENT ASSISTANT

Это одна из главных функций продукта.

Создать отдельного AI Procurement Assistant.

Он должен уметь:

- анализировать заявки;
- искать поставщиков;
- анализировать историю закупок;
- анализировать цены;
- создавать RFQ;
- анализировать КП;
- сравнивать поставщиков;
- обнаруживать аномалии;
- прогнозировать цену;
- объяснять рекомендации;
- готовить документы;
- формировать служебные записки;
- формировать сравнительные таблицы;
- помогать вести переговоры;
- контролировать сроки.

Пример:

Пользователь:

> Найди лучший вариант закупки кабеля КГ 4×16 на 2000 метров.

AI:

1. Проверяет историю.
2. Находит прошлую цену.
3. Находит подходящих поставщиков.
4. Проверяет текущие предложения.
5. Сравнивает.
6. Учитывает доставку.
7. Учитывает НДС.
8. Проверяет сроки.
9. Проверяет рейтинг.
10. Выдаёт recommendation.

---

# 13. AI AGENT

Не делать AI полностью автономным без контроля человека.

Использовать принцип:

**Human-in-the-loop.**

AI может:

- подготовить;
- найти;
- классифицировать;
- сравнить;
- рекомендовать;
- заполнить.

Но действия с финансовыми последствиями должны требовать разрешения.

Например:

AI:

> Рекомендуемый поставщик: ABC.

Кнопки:

**Approve Recommendation**

**Reject**

**Compare Manually**

**Request More Quotes**

---

# 14. SUPPLIER MANAGEMENT

Создать Supplier Master.

Поставщик:

```text
Company Name
Legal Name
TIN
Country
Region
Address
Contact Person
Phone
Email
Telegram
Website
Bank
MFO
Account
VAT Status
Categories
Documents
Contracts
Rating
Risk
Payment Terms
Delivery Terms
```

---

# 15. SUPPLIER SCORE

Автоматический рейтинг.

Например:

```text
Price                 25%
Delivery              20%
Quality               20%
Reliability           15%
Payment Terms         10%
Documentation          5%
Communication          5%
```

Настройки должны быть configurable.

Итог:

```text
Supplier Score: 93/100
```

Хранить историю рейтинга.

---

# 16. SUPPLIER PERFORMANCE

Показатели:

- On-time delivery;
- late deliveries;
- average delay;
- defect rate;
- price competitiveness;
- response rate;
- quotation response time;
- order fulfillment;
- return rate;
- claim rate.

---

# 17. SUPPLIER RISK

Создать Supplier Risk Score.

Учитывать:

- просрочки;
- качество;
- документы;
- частые изменения цен;
- возвраты;
- невыполненные заказы;
- финансовые признаки при наличии данных;
- концентрацию закупок;
- зависимость компании от одного поставщика.

AI должен показывать:

```text
Risk: Medium

Причины:
• 3 просрочки за последние 6 месяцев
• цена выше рынка на 7%
• отсутствует обновлённый документ
```

Не выдавать юридически значимые утверждения без подтверждённых данных.

---

# 18. RFQ / RFP / RFQ MANAGEMENT

Создать полноценный sourcing module.

Закупщик выбирает:

- товар;
- количество;
- спецификацию;
- срок;
- поставщиков.

Нажимает:

**Create RFQ**

Система генерирует RFQ.

---

# 19. КАНАЛЫ ОТПРАВКИ RFQ

Поддержать:

- Email;
- Telegram;
- Supplier Portal;
- API;
- ссылка.

В будущем:

- WhatsApp Business API при наличии официальной интеграции.

---

# 20. SUPPLIER PORTAL

Поставщик должен получить собственный портал.

Без необходимости регистрироваться в сложной ERP.

Поставщик открывает ссылку:

```text
RFQ #RFQ-2026-00125

Product:
КГ 4×16

Quantity:
2000 м

Submit Quote
```

Заполняет:

- цена;
- НДС;
- доставка;
- срок;
- гарантия;
- условия оплаты;
- комментарий;
- attachment.

Нажимает:

**Submit Quote**

---

# 21. AI DOCUMENT EXTRACTION

Критически важная функция.

Система должна принимать:

- PDF;
- Excel;
- CSV;
- DOCX;
- изображения;
- сканы.

AI/OCR извлекает:

- поставщика;
- товар;
- SKU;
- количество;
- цену;
- валюту;
- НДС;
- доставку;
- срок;
- гарантию;
- оплату.

Например поставщик прислал PDF.

Система превращает его в:

```text
Supplier: ABC LLC
Item: KG 4x16
Qty: 2000
Price: 18,500 UZS
VAT: 12%
Delivery: Included
Lead Time: 7 days
Payment: 50/50
```

Все AI-extracted поля должны иметь confidence score.

Например:

```text
Price confidence: 98%
Supplier confidence: 99%
Delivery confidence: 87%
```

Если confidence низкий:

**Ask human to verify.**

---

# 22. EXCEL IMPORT

Очень важный модуль.

Пользователь должен загрузить Excel.

Система:

1. анализирует колонки;
2. определяет структуру;
3. предлагает mapping;
4. показывает preview;
5. позволяет исправить mapping;
6. импортирует данные.

Поддержать:

- товары;
- поставщиков;
- цены;
- заявки;
- КП;
- каталоги.

---

# 23. КП COMPARISON

Создать лучший в системе модуль сравнения коммерческих предложений.

Сравнивать:

- цена;
- НДС;
- доставка;
- срок;
- условия оплаты;
- гарантия;
- качество;
- рейтинг;
- валюта;
- минимальный заказ;
- техническое соответствие.

Пример:

| Параметр | Supplier A | Supplier B | Supplier C |
| -------- | ---------: | ---------: | ---------: |
| Цена     |     18 500 |     18 200 |     19 100 |
| НДС      |        12% |        12% |         0% |
| Доставка |   Included |       $300 |   Included |
| Срок     |     7 дней |    20 дней |     5 дней |
| Рейтинг  |         94 |         87 |         91 |

---

# 24. TOTAL COST OF OWNERSHIP

Не сравнивать только цену.

Рассчитывать:

```text
Product Cost
+
VAT
+
Delivery
+
Customs
+
Bank Fees
+
Insurance
+
Financing Cost
+
Expected Risk Cost
=
Total Cost
```

Все компоненты должны быть configurable.

---

# 25. AI RECOMMENDATION ENGINE

AI должен рекомендовать поставщика.

Но recommendation должна быть объяснимой.

Пример:

> Рекомендуется Supplier C.

Причины:

- срок поставки на 15 дней быстрее;
- техническое соответствие 100%;
- рейтинг 91/100;
- доставка включена;
- отсутствие просрочек за последние 12 месяцев.

Также показывать:

> Cheapest option: Supplier B

> Best overall option: Supplier C

> Fastest option: Supplier C

---

# 26. NEGOTIATION ASSISTANT

Создать AI-помощника для переговоров.

Например:

> Supplier B предложил 18 500 сум. Историческая средняя цена — 17 900.

AI предлагает:

> Рекомендуемый target price: 18 000 сум.

И может сформировать сообщение:

> Добрый день. Благодарим за предложение. С учётом объёма 2000 м просим рассмотреть возможность цены 18 000 сум за метр при сохранении срока поставки...

Но AI не должен отправлять финансово значимые сообщения без подтверждения пользователя.

---

# 27. PRICE HISTORY

Для каждого товара хранить историю цен.

Показывать:

- supplier;
- date;
- quantity;
- price;
- currency;
- VAT;
- delivery;
- final cost.

Создать график.

AI:

> Средняя закупочная цена за последние 6 месяцев выросла на 8,4%.

---

# 28. PRICE INTELLIGENCE

AI должен обнаруживать:

- резкий рост;
- резкое падение;
- подозрительно низкую цену;
- подозрительно высокую цену;
- отклонение от истории;
- отклонение от рынка.

Например:

```text
⚠ Price anomaly

Current quote:
22,500 UZS

Historical average:
18,900 UZS

Deviation:
+19%
```

---

# 29. PURCHASE ORDER

Создать PO module.

Поля:

- PO number;
- supplier;
- items;
- quantity;
- price;
- tax;
- currency;
- delivery;
- payment terms;
- delivery address;
- responsible person;
- attachments;
- contract;
- approval.

Статусы:

```text
Draft
Pending Approval
Approved
Sent
Confirmed
Partially Delivered
Delivered
Cancelled
Closed
```

---

# 30. DELIVERY MANAGEMENT

Отслеживать:

- expected delivery;
- actual delivery;
- delay;
- quantity;
- partial delivery;
- remaining quantity.

AI должен уведомлять:

> Поставка ABC ожидается через 2 дня.

И:

> Поставка просрочена на 4 дня.

---

# 31. GOODS RECEIPT

Создать GRN.

Кладовщик:

- открывает PO;
- указывает фактическое количество;
- указывает состояние;
- загружает документы;
- подтверждает получение.

Поддержать:

- partial receipt;
- damaged goods;
- rejected goods;
- discrepancy.

---

# 32. INVOICE MANAGEMENT

Система должна принимать:

- PDF invoice;
- электронный документ;
- Excel;
- XML/API при наличии интеграции.

AI извлекает данные.

---

# 33. 3-WAY MATCHING

Обязательно реализовать:

```text
Purchase Order
        +
Goods Receipt
        +
Invoice
        =
3-Way Match
```

Проверять:

- supplier;
- item;
- quantity;
- price;
- tax;
- total.

При расхождении:

```text
⚠ Mismatch

PO quantity: 1000
Received: 950
Invoice: 1000
```

---

# 34. CONTRACT MANAGEMENT

Создать модуль договоров.

Хранить:

- contract;
- supplier;
- start date;
- end date;
- value;
- currency;
- payment terms;
- delivery terms;
- attachments.

Уведомлять:

> Договор заканчивается через 30 дней.

AI может извлекать ключевые условия из PDF договора.

---

# 35. BUDGET MANAGEMENT

Создать:

- annual budget;
- department budget;
- category budget;
- project budget.

Показывать:

```text
Budget
$1,000,000

Committed
$650,000

Spent
$510,000

Remaining
$350,000
```

---

# 36. SPEND ANALYTICS

Dashboard:

- total spend;
- spend by category;
- spend by supplier;
- spend by department;
- spend by month;
- spend by project;
- contracted vs non-contracted;
- savings;
- maverick spend.

---

# 37. SAVINGS TRACKING

Очень важная функция.

Система должна рассчитывать:

### Negotiated Savings

```text
Initial supplier price:
20,000

Final:
18,500

Saving:
1,500
```

### Competitive Savings

Сравнение с альтернативными предложениями.

### Avoided Cost

Разница между текущей и прогнозной ценой.

Все виды savings должны быть отдельными и не смешиваться.

---

# 38. PROCUREMENT DASHBOARD ДЛЯ ДИРЕКТОРА

Главная страница руководителя:

```text
TOTAL SPEND
1.24 млрд UZS

SAVINGS
86 млн UZS

OPEN REQUESTS
42

PENDING APPROVALS
13

LATE DELIVERIES
7

TOP SUPPLIER
ABC LLC

TOP CATEGORY
Raw Materials
```

AI summary:

> За текущий месяц расходы выросли на 8%. Основной рост связан с металлопрокатом. Средняя цена выросла на 5,2%. Есть возможность снизить расходы примерно на 42 млн UZS при перераспределении закупок между тремя поставщиками.

---

# 39. PROCUREMENT DASHBOARD ДЛЯ ЗАКУПЩИКА

Показывать:

- мои заявки;
- pending approvals;
- RFQ;
- ожидаемые КП;
- просроченные КП;
- активные закупки;
- ожидаемые поставки;
- просрочки;
- задачи;
- AI recommendations.

---

# 40. PROCUREMENT CALENDAR

Календарь:

- required dates;
- delivery dates;
- contract expiration;
- RFQ deadline;
- approval deadline;
- payment deadline.

---

# 41. NOTIFICATIONS

Channels:

- in-app;
- email;
- Telegram;
- push.

Уведомлять:

- новая заявка;
- approval;
- новая КП;
- изменение цены;
- просрочка;
- новая поставка;
- invoice mismatch;
- договор заканчивается;
- AI alert.

---

# 42. TELEGRAM BOT

Создать Telegram Bot.

Сотрудник может:

> /request

И создать заявку.

Например:

> Нужно 50 подшипников SKF 6205 до 20 сентября.

AI распознаёт.

Закупщик может:

> /rfq

> /suppliers

> /orders

> /approvals

> /delivery

Руководитель может получить:

> 🔴 Требуется ваше согласование

> Закупка: 185 000 000 UZS

Кнопки:

**Approve**

**Reject**

**View Details**

Критические действия должны проходить через безопасную авторизацию.

---

# 43. EMAIL

Поддержать:

- отправку RFQ;
- получение ответов;
- уведомления;
- approval;
- PO;
- invoice.

Создать email templates.

---

# 44. DOCUMENT GENERATION

Система должна создавать:

- RFQ;
- сравнительную таблицу;
- recommendation;
- служебную записку;
- PO;
- договорные приложения;
- отчёт;
- procurement summary.

Поддержать:

- PDF;
- DOCX;
- XLSX.

---

# 45. СЛУЖЕБНАЯ ЗАПИСКА

AI должен уметь автоматически формировать:

```text
Кому:
Директору

От:
Отдела снабжения

Тема:
О выборе поставщика...

Основание:
...

Проведено сравнение:
...

Предлагается:
...

Стоимость:
...

Экономия:
...
```

Но документ должен быть редактируемым человеком до отправки.

---

# 46. AUDIT LOG

Записывать абсолютно важные действия:

- кто создал;
- кто изменил;
- кто утвердил;
- кто отклонил;
- кто изменил цену;
- кто отправил RFQ;
- кто получил КП;
- кто изменил supplier;
- кто создал PO.

Хранить:

```text
user
timestamp
action
entity
entity_id
old_value
new_value
ip
metadata
```

Audit log нельзя удалять обычным пользователем.

---

# 47. APPROVAL ENGINE

Создать configurable workflow engine.

Пример:

```text
< 5 млн UZS
→ Procurement Manager

5–50 млн
→ Procurement Manager
→ Finance

> 50 млн
→ Procurement Manager
→ Finance
→ Director
```

Другой вариант:

```text
Raw Materials
→ Technical
→ Procurement
→ Finance
→ Director
```

Workflow должен настраиваться без изменения кода.

---

# 48. CONDITION ENGINE

Поддержать условия:

- amount;
- category;
- department;
- supplier;
- project;
- currency;
- risk;
- budget;
- urgency.

---

# 49. CATEGORY MANAGEMENT

Категории:

```text
IT Equipment
Raw Materials
Electrical
Mechanical
Office Supplies
Construction
Services
Logistics
Maintenance
```

Но категории должны быть configurable.

---

# 50. PRODUCT MASTER

Создать справочник товаров.

Поля:

- SKU;
- internal code;
- name;
- aliases;
- category;
- unit;
- brand;
- manufacturer;
- technical specifications;
- attachments;
- preferred suppliers.

---

# 51. DUPLICATE DETECTION

AI должен находить похожие товары.

Например:

```text
Кабель КГ 4х16
Кабель КГ 4×16
КГ-4*16
КГ 4 x 16
```

Система должна предложить:

> Возможно, это один и тот же товар.

Это особенно важно для компаний с плохими справочниками товаров.

---

# 52. SAP BUSINESS ONE INTEGRATION

TOP Procurement должен интегрироваться с SAP Business One.

Архитектура:

```text
TOP Procurement
       ↓
Integration Layer
       ↓
SAP Business One Service Layer / API
```

Синхронизировать:

- Business Partners;
- Items;
- Warehouses;
- Purchase Orders;
- Goods Receipts;
- AP Invoices;
- inventory;
- payments/status при необходимости.

Не создавать жёсткую зависимость от SAP.

Интеграционный слой должен поддерживать разные ERP.

---

# 53. ERP-AGNOSTIC ARCHITECTURE

В будущем:

- SAP Business One;
- SAP S/4HANA;
- Oracle;
- Microsoft Dynamics;
- 1C;
- custom ERP.

Создать интерфейс:

```text
ERPConnector
```

С методами:

```text
getSuppliers()
getProducts()
createPurchaseOrder()
getPurchaseOrder()
getGoodsReceipt()
getInvoice()
sync()
```

---

# 54. DIDОX / E-IMZO

Создать integration layer.

Не хардкодить внешние API.

```text
DocumentIntegrationProvider
```

Поддержать:

- Didox;
- E-IMZO;
- другие локальные провайдеры.

Все API keys и credentials:

**только server-side.**

---

# 55. ELECTRONIC PROCUREMENT PLATFORMS

Архитектуру подготовить для интеграции с локальными электронными закупочными площадками Узбекистана.

Не делать неподтверждённые интеграции.

Если официального API нет:

- использовать официальный механизм;
- либо оставить connector interface;
- либо manual import/export.

Никогда не использовать незаконный scraping.

---

# 56. AI ARCHITECTURE

AI должен быть отдельным сервисом.

Например:

```text
Frontend
↓
Backend API
↓
AI Orchestrator
↓
LLM
↓
Tools
```

AI Tools:

```text
searchSuppliers()
searchProducts()
getPriceHistory()
compareQuotes()
getSupplierScore()
getBudget()
createRFQ()
draftMessage()
generateReport()
```

AI не должен напрямую обращаться к database без контролируемого tool layer.

---

# 57. AI SAFETY

AI не должен:

- самостоятельно оплачивать;
- самостоятельно менять банковские реквизиты;
- самостоятельно менять supplier;
- самостоятельно утверждать крупные закупки;
- самостоятельно подписывать документы;
- самостоятельно отправлять финансово значимые документы.

Для таких операций:

**Human approval required.**

---

# 58. AI MEMORY

AI должен помнить контекст текущей закупки.

Например:

```text
Procurement #PR-2026-00125
```

AI должен знать:

- заявку;
- suppliers;
- RFQs;
- quotes;
- comments;
- approvals;
- PO;
- delivery;
- invoices.

Но tenant isolation обязателен.

---

# 59. SEARCH

Создать глобальный поиск.

Искать:

- заявки;
- товары;
- suppliers;
- RFQ;
- quotes;
- PO;
- contracts;
- invoices;
- documents.

Поддержать:

- exact;
- fuzzy;
- semantic search.

---

# 60. DOCUMENT SEARCH

В будущем сделать RAG.

Документы:

- договоры;
- КП;
- спецификации;
- техническая документация;
- инструкции.

Пользователь:

> Покажи условия оплаты по договору с ABC.

AI должен ответить с ссылкой на документ и конкретный фрагмент.

---

# 61. DATABASE

Выбери production-ready relational database.

Предпочтительно:

**PostgreSQL**

ORM:

например:

- Prisma;
- Drizzle;
- SQLAlchemy;

Выбери один стек и обоснуй выбор.

Не смешивай ORM без необходимости.

---

# 62. BACKEND

Предпочтительный стек:

### Option A

Node.js\
+\
TypeScript\
+\
NestJS\
+\
PostgreSQL\
+\
Prisma

или другой production-ready стек, если ты считаешь его объективно лучше.

Главное:

- clean architecture;
- modularity;
- type safety;
- validation;
- testing;
- security.

---

# 63. FRONTEND

Предпочтительно:

React\
+\
Next.js\
+\
TypeScript

UI:

- современный;
- минималистичный;
- профессиональный;
- enterprise;
- быстрый.

Не делать дизайн похожим на cartoon startup.

---

# 64. UI STYLE

Визуальный стиль:

**Modern Procurement SaaS**

Характер:

- минимализм;
- много воздуха;
- аккуратные таблицы;
- понятные статусы;
- профессиональная типографика;
- хорошие charts;
- subtle borders;
- compact data density.

Основные экраны должны выглядеть как серьёзная B2B-система.

---

# 65. DASHBOARD

Использовать:

- cards;
- tables;
- charts;
- status badges;
- KPI;
- filters;
- drill-down.

Dashboard должен быть не декоративным.

Каждый KPI должен быть кликабельным.

---

# 66. RESPONSIVE

Обязательно:

Desktop\
Tablet\
Mobile

На мобильном:

- заявки;
- approvals;
- notifications;
- supplier responses;
- delivery status;
- AI assistant.

---

# 67. PWA / MOBILE

Сделать архитектуру готовой для:

- PWA;
- iOS;
- Android.

На первом этапе можно сделать responsive web + PWA.

---

# 68. API

Создать REST API.

В будущем возможно GraphQL, если потребуется.

API:

```text
/auth
/users
/organizations
/departments
/products
/categories
/suppliers
/purchase-requests
/rfqs
/quotes
/comparisons
/recommendations
/purchase-orders
/deliveries
/goods-receipts
/invoices
/contracts
/budgets
/analytics
/notifications
/integrations
/ai
```

---

# 69. API DOCUMENTATION

Использовать:

**OpenAPI / Swagger**

Документация должна генерироваться автоматически.

---

# 70. AUTHENTICATION

Поддержать:

- email/password;
- password reset;
- email verification;
- MFA;
- session management;
- refresh tokens;
- OAuth/SSO в будущем.

Пароли:

**Argon2id или bcrypt.**

Никогда не хранить plain-text passwords.

---

# 71. SECURITY

Обязательно:

- HTTPS;
- JWT/session security;
- RBAC;
- tenant isolation;
- CSRF protection;
- rate limiting;
- input validation;
- SQL injection protection;
- XSS protection;
- secure headers;
- encrypted secrets;
- secure file upload;
- virus scanning;
- audit logs.

---

# 72. FILE STORAGE

Документы могут быть:

- PDF;
- XLSX;
- DOCX;
- images.

Хранение:

S3-compatible object storage.

Например:

- AWS S3;
- Cloudflare R2;
- MinIO.

Database должна хранить metadata, а не большие файлы.

---

# 73. BACKGROUND JOBS

Использовать queue system.

Например:

- Redis;
- BullMQ.

Background jobs:

- email;
- Telegram;
- AI document processing;
- OCR;
- analytics;
- ERP synchronization;
- notifications.

---

# 74. OBSERVABILITY

Добавить:

- structured logging;
- error tracking;
- metrics;
- tracing;
- health checks.

В production подготовить:

- Sentry;
- OpenTelemetry;
- Prometheus/Grafana.

---

# 75. TESTING

Минимум:

### Unit tests

- business logic;
- calculations;
- scoring;
- tax engine.

### Integration tests

- database;
- APIs;
- ERP connectors.

### E2E

Основной workflow:

```text
Request
→ Approval
→ RFQ
→ Quote
→ Comparison
→ Recommendation
→ PO
→ Receipt
→ Invoice
→ Match
```

---

# 76. CRITICAL BUSINESS TESTS

Обязательно протестировать:

### Currency

UZS/USD/EUR.

### VAT

Разные tax rules.

### Quantity

Partial delivery.

### Price

Price changes.

### Approval

Different thresholds.

### Tenant isolation

Tenant A не видит Tenant B.

### Supplier

Duplicate supplier detection.

### Product

Duplicate product detection.

---

# 77. ANALYTICS ENGINE

Не выполнять тяжёлые аналитические запросы напрямую на production tables при больших объёмах.

Подготовить:

- materialized views;
- aggregation tables;
- caching;
- warehouse-ready architecture.

---

# 78. EVENT-DRIVEN ARCHITECTURE

Использовать domain events там, где это полезно.

Например:

```text
PurchaseRequestCreated
PurchaseRequestApproved
RFQCreated
QuoteReceived
QuoteAnalyzed
SupplierSelected
PurchaseOrderCreated
PurchaseOrderApproved
GoodsReceived
InvoiceReceived
InvoiceMatched
```

---

# 79. NOTIFICATION EVENT

Пример:

```text
QuoteReceived
↓
Notification Service
↓
Email
Telegram
In-App
```

---

# 80. ADMIN PANEL

Администратор должен управлять:

- organizations;
- users;
- roles;
- permissions;
- categories;
- tax rules;
- currencies;
- workflows;
- notification templates;
- integrations;
- AI settings;
- subscription;
- audit logs.

---

# 81. BILLING

Система должна быть SaaS.

Подготовить:

### Starter

Для небольших компаний.

### Business

Для среднего бизнеса.

### Enterprise

Для крупных компаний.

Pricing architecture должна быть configurable.

Не привязывать бизнес-логику к конкретным ценам.

---

# 82. PRODUCT METRICS

Собирать:

- active organizations;
- active users;
- purchase requests;
- RFQs;
- quote response rate;
- average procurement cycle;
- savings;
- supplier activity;
- AI usage;
- automation rate.

---

# 83. КЛЮЧЕВЫЕ KPI ПРОДУКТА

Главные:

### Procurement Cycle Time

Сколько времени проходит:

Request → PO.

### Savings

Сколько компания сэкономила.

### Automation Rate

Какой процент операций выполнен автоматически.

### Supplier Response Rate

Как часто поставщики отвечают.

### On-Time Delivery

Процент поставок вовремя.

---

# 84. ОСОБЕННО ВАЖНАЯ ФУНКЦИЯ

Создать показатель:

## Procurement Automation Score

Например:

```text
78%

Заявка создана AI
✓

Поставщики найдены AI
✓

RFQ создан AI
✓

КП распознаны AI
✓

Сравнение AI
✓

Выбор поставщика
Human

PO создан автоматически
✓

Approval
Human
```

---

# 85. AI INSIGHTS

На dashboard показывать:

### Opportunities

> Можно снизить расходы на 8%.

### Risks

> 23% закупок зависят от одного поставщика.

### Alerts

> Supplier ABC имеет 3 просрочки.

### Trends

> Средняя цена кабеля выросла на 6%.

---

# 86. PROCUREMENT CATEGORY STRATEGY

AI должен помогать анализировать категории.

Например:

```text
Category:
Electrical Materials

Annual Spend:
12.4 млрд UZS

Suppliers:
18

Top Supplier Share:
61%

Potential Savings:
4–7%
```

---

# 87. SPEND CONCENTRATION

Показывать:

> 61% закупок категории приходится на одного поставщика.

AI:

> Рекомендуется квалифицировать минимум двух альтернативных поставщиков.

---

# 88. SUPPLIER CONSOLIDATION

AI может предложить:

> У компании 14 поставщиков для одинаковой категории. Консолидация объёмов может увеличить переговорную силу.

---

# 89. DEMAND CONSOLIDATION

Если разные отделы создают:

```text
20 шт.
30 шт.
50 шт.
```

одного товара,

AI должен предложить:

> Объединить заявки в одну закупку 100 шт. и получить более выгодную цену.

Это очень важная функция.

---

# 90. INVENTORY-AWARE PROCUREMENT

Если есть интеграция с ERP/складом:

AI должен учитывать:

- current stock;
- reserved;
- incoming;
- consumption;
- reorder point.

И предупреждать:

> На складе уже 1 200 единиц. Дополнительная закупка 1 000 единиц может привести к избыточному запасу.

---

# 91. PRODUCTION / BOM

Для производственных компаний подготовить модуль BOM.

Например:

```text
Product A

Material 1 — 100
Material 2 — 20
Material 3 — 5
```

AI:

> Для производства 1000 единиц Product A необходимо закупить...

И автоматически создать purchase requirements.

---

# 92. FORECASTING

В будущем:

- demand forecast;
- price forecast;
- supplier lead-time forecast;
- stockout prediction.

Но прогнозы должны показывать confidence.

---

# 93. NO HALLUCINATION POLICY

AI не должен придумывать:

- цены;
- поставщиков;
- наличие;
- сроки;
- документы;
- юридические условия.

Если данных нет:

> Данных недостаточно.

Каждая важная AI-рекомендация должна иметь источник.

---

# 94. AI EXPLANATIONS

Не показывать скрытый chain-of-thought.

Показывать только краткое объяснение результата:

```text
Recommendation:
Supplier A

Reasons:
1. Lowest total cost
2. Best delivery time
3. Strong supplier score
4. No late deliveries in last 12 months
```

---

# 95. DATABASE ENTITIES

Минимальный список:

```text
Organization
User
Role
Permission
Department
CostCenter
Project

Category
Product
ProductAlias
Unit

Supplier
SupplierContact
SupplierDocument
SupplierRating
SupplierRisk

PurchaseRequest
PurchaseRequestItem

RFQ
RFQItem
RFQSupplier

Quote
QuoteItem

QuoteComparison
Recommendation

PurchaseOrder
PurchaseOrderItem

Delivery
GoodsReceipt
GoodsReceiptItem

Invoice
InvoiceItem

Contract

Budget
BudgetLine

Currency
TaxRule

Notification
NotificationTemplate

Attachment

ApprovalWorkflow
ApprovalStep
ApprovalInstance

AuditLog

Integration
IntegrationCredential

AIConversation
AIMessage
AIToolCall
AIExtraction

Subscription
Plan
Usage
```

---

# 96. DATABASE RELATIONSHIPS

Спроектируй нормальную relational schema.

Не допускай:

- giant JSON database;
- duplicate data;
- hidden relationships;
- hardcoded business rules.

JSONB можно использовать там, где это действительно оправдано, например для динамических technical specifications.

---

# 97. TECHNICAL SPECIFICATIONS

Технические характеристики товара должны быть гибкими.

Например:

```json
{
  "voltage": "220V",
  "power": "5kW",
  "diameter": "50mm"
}
```

Но category schema должна определять допустимые поля.

---

# 98. SEARCH NORMALIZATION

Учитывать:

- русский;
- узбекский;
- английский;
- кириллицу;
- латиницу;
- x/х;
- ×;
- дефисы;
- пробелы.

Например:

```text
КГ 4х16
КГ 4x16
КГ 4×16
КГ-4х16
```

должны находиться.

---

# 99. UX — ОСНОВНОЕ МЕНЮ

Предложи и реализуй примерно:

```text
Dashboard

Procurement
 ├ Requests
 ├ RFQs
 ├ Quotes
 ├ Comparisons
 ├ Purchase Orders
 ├ Deliveries
 └ Invoices

Suppliers

Products

Contracts

Budgets

Analytics

AI Assistant

Documents

Integrations

Settings
```

---

# 100. GLOBAL AI BUTTON

В интерфейсе должен быть доступен:

**Ask TOP AI**

Пользователь может спросить:

> Какие закупки сейчас требуют моего внимания?

> Какие поставщики задерживают поставки?

> Где мы переплачиваем?

> Какие КП нужно сравнить?

> Что можно купить дешевле?

> Какие договоры заканчиваются?

---

# 101. AI COMMANDS

AI должен уметь выполнять read-only действия:

> Покажи все просроченные поставки.

> Сравни последние 10 закупок кабеля.

> Найди поставщиков для подшипника 6205.

> Покажи закупки выше 100 млн.

Для write actions:

> Создай RFQ.

AI должен создать draft и попросить подтверждение.

---

# 102. DESIGN SYSTEM

Создать reusable components:

- Button;
- Input;
- Select;
- DataTable;
- Modal;
- Drawer;
- Tabs;
- Badge;
- Card;
- Timeline;
- ApprovalTimeline;
- SupplierScore;
- QuoteComparison;
- PriceChart;
- AIInsight;
- DocumentViewer;
- FileUploader.

---

# 103. DATA TABLES

Таблицы должны иметь:

- search;
- filters;
- sorting;
- pagination;
- column visibility;
- export;
- saved views.

---

# 104. EXPORT

Поддержать:

- Excel;
- CSV;
- PDF.

---

# 105. IMPORT

Поддержать:

- Excel;
- CSV.

AI mapping должен помогать пользователю сопоставлять поля.

---

# 106. PERFORMANCE

Цели:

- initial page load < 2.5 sec при нормальном соединении;
- API p95 < 500ms для обычных операций;
- async для тяжёлых AI/OCR tasks;
- pagination;
- caching;
- lazy loading.

---

# 107. SCALABILITY

Архитектура должна позволять:

```text
100 organizations
→ 1,000
→ 10,000+
```

Не проектировать систему только на 10 компаний.

---

# 108. DEPLOYMENT

Подготовить:

- Docker;
- docker-compose;
- environment variables;
- migrations;
- seed;
- CI/CD.

Services:

```text
frontend
backend
postgres
redis
worker
object-storage
```

---

# 109. ENVIRONMENTS

Создать:

```text
development
staging
production
```

---

# 110. ENVIRONMENT VARIABLES

Никогда не помещать secrets в Git.

Например:

```env
DATABASE_URL=
REDIS_URL=

JWT_SECRET=

OPENAI_API_KEY=
ANTHROPIC_API_KEY=

SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=

TELEGRAM_BOT_TOKEN=

S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=

SAP_BASE_URL=
SAP_USERNAME=
SAP_PASSWORD=

DIDOX_API_KEY=
```

Использовать secret manager в production.

---

# 111. SEED DATA

Создать demo organization:

**TOP Demo Company**

Создать:

- departments;
- users;
- suppliers;
- products;
- purchase requests;
- RFQs;
- quotes;
- POs;
- deliveries.

Чтобы после запуска система сразу выглядела живой.

---

# 112. DEMO PROCUREMENT

Создать демонстрационную закупку:

```text
Кабель КГ 4×16
Quantity: 2000 m
```

3 поставщика.

Разные:

- цены;
- сроки;
- условия;
- рейтинги.

Показать AI recommendation.

---

# 113. AI DEMO

После запуска пользователь должен увидеть:

> AI проанализировал 3 предложения.

> Supplier C рекомендован как лучший overall option.

> Потенциальная экономия: 4.2%.

---

# 114. REAL DATA VS MOCK DATA

В production:

**никаких mock данных.**

Mock/demo data использовать только:

- seed;
- development;
- demo mode;
- tests.

Не создавать фальшивую интеграцию.

Если API недоступен:

создать connector interface + mock adapter отдельно.

---

# 115. INTEGRATION ARCHITECTURE

Все интеграции должны быть adapter-based.

Например:

```text
SupplierProvider
ERPProvider
DocumentProvider
MessagingProvider
AIProvider
PaymentProvider
```

---

# 116. AI PROVIDER ABSTRACTION

Не привязывать приложение к одному LLM.

Создать:

```text
AIProvider
```

Поддержать:

- Anthropic;
- OpenAI;
- другие модели.

Можно выбирать модель для:

- extraction;
- classification;
- reasoning;
- chat;
- summarization.

---

# 117. COST CONTROL

AI usage должен отслеживаться.

Хранить:

- model;
- tokens;
- cost;
- request;
- tenant;
- user;
- operation.

Добавить AI usage limits.

---

# 118. AI CACHE

Если одинаковый документ уже обработан:

не обрабатывать повторно без необходимости.

Создать hash документа.

---

# 119. AI DOCUMENT PIPELINE

```text
Upload
↓
Virus Scan
↓
File Hash
↓
OCR if required
↓
Document Classification
↓
Extraction
↓
Validation
↓
Human Review if needed
↓
Structured Data
```

---

# 120. DOCUMENT VERSIONING

Если пользователь заменяет документ:

не удалять старую версию.

Хранить:

```text
v1
v2
v3
```

---

# 121. LEGAL / COMPLIANCE

Архитектура должна позволять:

- data retention;
- data export;
- account deletion;
- audit;
- consent where required.

Не утверждать юридическое соответствие конкретному законодательству без проверки актуальных официальных требований.

---

# 122. НЕ ДЕЛАТЬ

Не делать:

- микросервисную архитектуру ради моды;
- слишком сложный Kubernetes на MVP;
- десятки ненужных библиотек;
- giant component;
- giant controller;
- giant service;
- hardcoded workflow;
- hardcoded tax;
- hardcoded currency;
- hardcoded roles;
- secrets в frontend;
- прямые AI database queries;
- fake integrations;
- fake AI recommendations.

---

# 123. MVP

Первый MVP должен включать:

### Authentication

✓

### Organizations

✓

### Users/Roles

✓

### Purchase Requests

✓

### Suppliers

✓

### RFQ

✓

### Supplier Portal

✓

### Quotes

✓

### AI Quote Extraction

✓

### Quote Comparison

✓

### Supplier Score

✓

### Approval Workflow

✓

### Purchase Orders

✓

### Delivery tracking

✓

### Invoice

✓

### Dashboard

✓

### AI Assistant

✓

### Telegram notifications

✓

### Excel import/export

✓

---

# 124. PHASE 2

Добавить:

- SAP Business One;
- Didox;
- E-IMZO;
- advanced analytics;
- contracts;
- budget;
- 3-way matching;
- price intelligence;
- demand consolidation;
- inventory integration.

---

# 125. PHASE 3

Добавить:

- AI procurement agents;
- forecasting;
- BOM sourcing;
- supplier marketplace;
- electronic auctions;
- external supplier discovery;
- advanced risk;
- mobile apps.

---

# 126. MARKETPLACE FUTURE

В будущем TOP Procurement может превратиться из внутренней системы в B2B ecosystem.

```text
Buyer
  ↕
TOP Procurement
  ↕
Supplier Network
```

Поставщики смогут:

- создавать профиль;
- добавлять товары;
- получать RFQ;
- отправлять КП;
- участвовать в торгах;
- получать рейтинг.

Но marketplace НЕ должен быть обязательной частью MVP.

---

# 127. МОБИЛЬНЫЙ СЦЕНАРИЙ ДИРЕКТОРА

Директор открывает телефон.

Видит:

```text
3 approvals waiting

1.
Raw materials
125,000,000 UZS

AI Recommendation:
Supplier ABC

Potential saving:
8,500,000 UZS
```

Кнопки:

**Approve**

**Reject**

**View**

---

# 128. МОБИЛЬНЫЙ СЦЕНАРИЙ ЗАКУПЩИКА

Закупщик:

```text
12 active RFQs
4 quotes received
3 approvals
2 delayed deliveries
```

Нажимает RFQ.

Видит:

```text
3 / 5 suppliers responded
```

AI:

> Рекомендуется запросить дополнительное предложение у 2 поставщиков.

---

# 129. МЕТРИКА УСПЕХА

Главный вопрос продукта:

> Сколько времени и денег TOP Procurement экономит закупщику?

Например:

До TOP:

```text
RFQ comparison:
2 hours
```

После TOP:

```text
15 minutes
```

До:

```text
Manual data entry
```

После:

```text
AI extraction
```

---

# 130. ONBOARDING

Новый клиент:

### Step 1

Создаёт компанию.

### Step 2

Добавляет сотрудников.

### Step 3

Импортирует suppliers Excel.

### Step 4

Импортирует products.

### Step 5

Настраивает approval rules.

### Step 6

Создаёт первую заявку.

Сделать onboarding wizard.

---

# 131. IMPORT ASSISTANT

При загрузке Excel:

```text
We found:

1,254 suppliers
8,421 products
```

Показывать:

- duplicates;
- missing fields;
- invalid TIN;
- invalid currency;
- duplicate suppliers.

---

# 132. DATA QUALITY

Создать Data Quality dashboard:

```text
Suppliers:
94% complete

Products:
78% complete

Duplicates:
124

Missing tax data:
31
```

---

# 133. AI DATA CLEANING

AI может предложить:

> Supplier "ABC LTD" и "ООО ABC" вероятно являются одной организацией.

Но объединение только после подтверждения пользователя.

---

# 134. PROCUREMENT POLICY ENGINE

Компания может задать:

```text
Minimum RFQ suppliers:
3

Required approval:
> 50m UZS

Preferred supplier:
Allowed

Single-source:
Requires justification
```

Система должна автоматически проверять compliance.

---

# 135. PROCUREMENT COMPLIANCE

Если закупщик пытается купить без требуемого количества КП:

```text
⚠ Policy violation

Company policy requires:
3 quotations

Current:
1 quotation

Reason required.
```

---

# 136. SINGLE SOURCE

Если закупка только у одного поставщика:

требовать:

- reason;
- justification;
- approval.

---

# 137. CONFLICT OF INTEREST

Подготовить архитектуру для деклараций:

- employee;
- supplier;
- relationship.

Не утверждать наличие конфликта без доказательств.

---

# 138. DUPLICATE PURCHASE DETECTION

AI должен искать:

> За последние 7 дней уже была заявка на этот товар от другого подразделения.

Предложить объединить.

---

# 139. PROCUREMENT CALCULATOR

Создать utility:

- VAT;
- currency;
- discount;
- markup;
- total cost;
- savings;
- percentage.

Все расчёты делать backend-side для критичных операций.

---

# 140. ROUNDING

Определить единые правила:

- currency precision;
- tax precision;
- quantity precision.

Не использовать JavaScript floating point для финансовых расчётов.

Использовать Decimal/NUMERIC.

---

# 141. FINANCIAL DATA

Все денежные значения хранить:

**NUMERIC/DECIMAL**

Никогда не использовать float для денег.

---

# 142. TIMEZONE

Default timezone:

**Asia/Tashkent**

Но tenant должен иметь возможность изменить timezone.

---

# 143. DATE FORMAT

В интерфейсе:

```text
DD.MM.YYYY
```

Backend:

ISO 8601.

---

# 144. AUDITABLE AI

Для каждой AI recommendation хранить:

- input;
- output;
- model;
- timestamp;
- source documents;
- confidence;
- user approval.

---

# 145. AI RECOMMENDATION VERSION

Если AI-рекомендация изменена:

не перезаписывать старую.

Создавать новую версию.

---

# 146. ERROR HANDLING

Каждая ошибка должна иметь:

- user-friendly message;
- technical log;
- correlation ID.

Пользователю не показывать stack trace.

---

# 147. EMPTY STATES

Каждый экран должен иметь хороший empty state.

Например:

> Пока нет заявок.

> Создайте первую заявку или попросите TOP AI создать её.

---

# 148. LOADING STATES

Использовать:

- skeleton;
- progress;
- optimistic UI там, где безопасно.

---

# 149. AI PROCESSING UI

Когда AI анализирует PDF:

```text
Uploading
✓

Reading document
✓

Extracting supplier
✓

Extracting products
...

Comparing prices
...
```

Пользователь должен понимать, что происходит.

---

# 150. FINAL PRODUCT PRINCIPLE

TOP Procurement должен ощущаться не как:

> ERP software

а как:

> **AI coworker for procurement teams.**

Пользователь должен чувствовать:

> «Я не работаю один. TOP помогает мне искать, сравнивать, проверять и контролировать закупки.»

---

# 151. ТРЕБОВАНИЯ К ТВОЕЙ РАБОТЕ

Не начинай сразу писать тысячи строк кода.

Сначала:

## STEP 1 — PRODUCT ARCHITECTURE

Опиши:

- modules;
- roles;
- workflows;
- data model;
- integrations;
- AI architecture.

## STEP 2 — TECH STACK

Выбери стек.

Объясни выбор.

## STEP 3 — DATABASE

Создай ERD и schema.

## STEP 4 — API

Создай API architecture.

## STEP 5 — UI/UX

Создай карту экранов.

## STEP 6 — MVP

Разбей реализацию на milestones.

## STEP 7 — IMPLEMENTATION

После утверждения архитектуры начинай кодирование.

---

# 152. КОД

Код должен быть:

- production-ready;
- TypeScript;
- typed;
- modular;
- documented;
- tested.

Не использовать:

```text
any
```

без серьёзной причины.

Не создавать огромные файлы.

Каждый module должен иметь чёткую ответственность.

---

# 153. CODE QUALITY

Следовать:

- SOLID;
- DRY;
- KISS;
- Clean Architecture там, где она оправдана;
- separation of concerns.

Но не переусложнять.

---

# 154. GIT STRUCTURE

Предложи:

```text
apps/
  web/
  api/
  worker/

packages/
  ui/
  config/
  types/
  database/
  ai/
  integrations/
```

Если считаешь другую структуру лучше — объясни.

---

# 155. README

Создай полноценный README:

- overview;
- architecture;
- requirements;
- installation;
- environment variables;
- database;
- migrations;
- seed;
- development;
- tests;
- deployment;
- integrations;
- AI setup.

---

# 156. DEVELOPMENT

Создай:

```bash
docker compose up
```

после чего developer должен получить:

- PostgreSQL;
- Redis;
- object storage;
- backend;
- frontend.

---

# 157. DEMO LOGIN

Создать demo users:

```text
admin@demo.local
director@demo.local
procurement@demo.local
finance@demo.local
employee@demo.local
supplier@demo.local
```

Пароли только для development/demo.

Не использовать реальные production credentials.

---

# 158. FINAL DELIVERABLES

В конце должны быть:

1. Product architecture
2. System architecture
3. ERD
4. Database schema
5. API specification
6. UI map
7. RBAC matrix
8. Workflow engine
9. AI architecture
10. Integration architecture
11. Security architecture
12. MVP roadmap
13. Production code
14. Tests
15. Docker setup
16. Seed data
17. README
18. Deployment instructions

---

# 159. ПРИНЦИП ПРИОРИТЕТА

Если приходится выбирать между:

**Красивым UI**

и

**правильной бизнес-логикой**

всегда выбирай бизнес-логику.

Если приходится выбирать между:

**AI-фичей**

и

**надёжностью финансовых расчётов**

всегда выбирай надёжность.

Если приходится выбирать между:

**автоматизацией**

и

**контролем человека**

для финансово значимых операций всегда оставляй Human-in-the-loop.

---

# 160. САМОЕ ВАЖНОЕ

Не создавай приложение, которое просто хранит заявки.

Создай систему, которая реально помогает закупщику.

Главная цепочка:

```text
NEED
↓
REQUEST
↓
AI
↓
SUPPLIERS
↓
RFQ
↓
QUOTES
↓
AI EXTRACTION
↓
COMPARISON
↓
TOTAL COST
↓
SUPPLIER SCORE
↓
AI RECOMMENDATION
↓
HUMAN APPROVAL
↓
PO
↓
DELIVERY
↓
GRN
↓
INVOICE
↓
3-WAY MATCH
↓
PAYMENT
↓
ANALYTICS
↓
AI INSIGHTS
```

---

# 161. ТВОЯ РОЛЬ

Не соглашайся автоматически со всеми моими решениями.

Если видишь архитектурную ошибку — скажи.

Если функция не нужна MVP — скажи.

Если выбранная технология плоха — предложи лучшую.

Если требования противоречат друг другу — выяви конфликт.

Если решение может создать security risk — предупреди.

Если feature слишком дорогая или сложная — предложи MVP-вариант.

Работай как CTO, которому поручили вывести настоящий B2B SaaS-продукт на рынок.

---

# 162. ПЕРВАЯ ЗАДАЧА

Начни НЕ с кода.

Сначала подготовь:

## A. Executive Summary

Что такое TOP Procurement.

## B. Competitive Positioning

Сравни концепцию с:

- SAP Ariba;
- Coupa;
- Ivalua;
- GEP SMART;
- JAGGAER;
- Oracle Procurement;
- Zycus;
- Precoro;
- Procurify;
- Pipefy.

Покажи:

- что взять;
- что НЕ брать;
- где наше конкурентное преимущество.

## C. Product Architecture

Полная архитектура.

## D. MVP Scope

Что обязательно входит в первую версию.

## E. Phase 2

Что оставить на второй этап.

## F. Phase 3

Что оставить на масштабирование.

## G. Technology Stack

Выбери конкретный стек.

## H. Database Architecture

Создай ERD.

## I. API Architecture

Опиши endpoints.

## J. AI Architecture

Опиши AI agents/tools/providers.

## K. UI/UX

Опиши все экраны.

## L. Security

Опиши модель безопасности.

## M. Deployment

Опиши production deployment.

## N. Development Roadmap

Разбей работу на последовательные этапы.

---

# 163. ФОРМАТ ОТВЕТА

Отвечай структурированно.

Используй:

- Markdown;
- таблицы;
- Mermaid diagrams;
- code blocks;
- архитектурные схемы;
- checklists.

Не пиши общие фразы.

Каждое архитектурное решение объясняй с точки зрения:

**почему → как → плюсы → минусы → альтернатива.**

---

# 164. КРИТЕРИЙ УСПЕХА

В конце должен получиться не просто концепт.

Мы должны иметь ясный путь:

```text
Idea
↓
Architecture
↓
MVP
↓
Working SaaS
↓
Pilot company
↓
SAP/Didox integration
↓
First paying customers
↓
Uzbekistan market
↓
Regional expansion
```

---

# 165. ГЛАВНАЯ ЦЕЛЬ

Создать продукт, который позволит компании сказать:

> «Мы больше не управляем закупками через Excel, Telegram и десятки файлов. Все закупки проходят через TOP Procurement, а AI помогает закупщику принимать лучшие решения быстрее.»

Начинай с **архитектуры и MVP**, затем переходи к реализации последовательно.

Не пропускай фундаментальные этапы.

Не пиши код до тех пор, пока не определены архитектура, database schema, API и MVP scope.
