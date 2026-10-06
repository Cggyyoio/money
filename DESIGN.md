# MoneyFlow Manager — وثيقة التصميم

## 1. تحليل المتطلبات (الخلاصة)

**جوهر النظام:** دفتر حسابات (Ledger) غير قابل للتعديل أو الحذف، وكل الأرصدة والأرباح والتقارير تُشتق منه بالحساب. لا يوجد أي رقم رصيد يُخزَّن ويُعدَّل يدويًا.

**ثلاثة مفاهيم يجب ألا تختلط أبدًا:**
1. **الأموال** = مجموع حركات الـLedger لكل حساب.
2. **الأرباح** = فرق بين ما دفعه العميل وما خصمه المزود (تُحسب من العملية).
3. **المصاريف** = شخصية أو عمل (تصنيف إلزامي، لا تُحسب ضمن الربح التجاري).

**التحويل الداخلي** يؤثر على حسابين فقط ولا يظهر في أي تقرير دخل/مصروف/ربح.

## 2. Architecture

Modular Monolith (تطبيق واحد منظم بوحدات) — الأنسب لمستخدم واحد/فريق صغير، سهل النشر والنسخ الاحتياطي، وقابل للتقسيم لاحقًا.

```
Client (React PWA, RTL, Mobile-first)
        │  HTTPS + httpOnly cookie
API (Fastify + TypeScript)
  ├─ modules/auth        (login, 2FA, sessions, devices, PIN)
  ├─ modules/accounts
  ├─ modules/ledger      ← قلب النظام (الخدمة الوحيدة المسموح لها بالكتابة في ledger_entries)
  ├─ modules/transactions (بيع/شراء/تحويل/شحن/سحب...)
  ├─ modules/expenses, income, debts, adjustments, recurring
  ├─ modules/customers, providers, services
  ├─ modules/reports, goals, networth
  ├─ modules/notifications, audit, backup, fx
  └─ jobs (cron: recurring, snapshots, alerts)
PostgreSQL (المصدر الوحيد للحقيقة)
```

**قاعدة صارمة:** أي وحدة تريد تحريك المال تستدعي `LedgerService.post(...)` داخل Database Transaction واحدة. لا كتابة مباشرة في جدول الحركات من أي مكان آخر.

## 3. Tech Stack

| الطبقة | الاختيار | السبب |
|---|---|---|
| Backend | Node.js 22 + TypeScript + Fastify | سريع، Types قوية، Validation مدمج |
| Validation | Zod | التحقق من كل مدخل |
| DB | PostgreSQL 16 | NUMERIC دقيق، Constraints، Triggers، Views |
| Data access | Drizzle ORM + SQL خام للتقارير | تحكم كامل في الـSQL المالي |
| الأرقام | `NUMERIC(20,6)` في DB + `decimal.js` في الكود | لا Floating Point إطلاقًا |
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui | Mobile-first |
| State/Data | TanStack Query | |
| Charts | Recharts | |
| PWA | vite-plugin-pwa | يثبَّت على الهاتف كتطبيق |
| i18n/RTL | عربي افتراضي + إنجليزي | |
| Auth | argon2id، TOTP (2FA)، جلسات في DB، CSRF، Rate limit | |
| Export | exceljs (Excel)، CSV، pdfkit/Puppeteer (PDF) | |
| Tests | Vitest + اختبارات تكامل على DB حقيقية | |
| Deploy | Docker Compose (api + postgres + nginx) + نسخ احتياطي مجدول | |

## 4. الصلاحيات (Roles)

- **owner**: كل شيء، بما فيه الإعدادات والنسخ الاحتياطي والمستخدمين.
- **accountant**: إدخال العمليات والتقارير، بلا إعدادات الأمان أو الاستعادة.
- **viewer**: عرض فقط.
- كل البيانات مرتبطة بـ`workspace_id` (جاهز لتعدد المستخدمين دون إعادة تصميم).
- العمليات الحساسة (تعديل مبلغ، تسوية، إلغاء، استرداد، تصدير، استعادة نسخة) تتطلب **PIN**.

## 5. تصميم الـLedger (الأهم)

### المبادئ
- `ledger_entries` **Append-only**: ممنوع UPDATE وDELETE (تُفرض بـTrigger في PostgreSQL، وليس فقط في الكود).
- كل حركة = سطر موقّع: موجب = دخول للحساب، سالب = خروج.
- الإلغاء/الاسترداد = **إدخال قيود عكسية** (`reverses_entry_id`) وليس حذفًا.
- الرصيد = `SUM(amount)` من القيود **المعتمدة** (status = posted) للحساب.
- العمليات المعلّقة (pending) لا تؤثر على الرصيد، وتظهر كـ"رصيد معلّق" منفصل. الفاشلة لا قيود لها.

### الجداول الأساسية
```
ledger_entries(
  id, workspace_id, transaction_id, account_id,
  amount            NUMERIC(20,6)  -- موقّع، بعملة الحساب
  currency          CHAR(4),
  fx_rate           NUMERIC(20,8)  -- سعر الصرف لحظة القيد إلى EGP
  base_amount       NUMERIC(20,6)  -- amount * fx_rate (مجمّد، لا يتغير)
  entry_type        ENUM(principal_in, principal_out, transfer_in, transfer_out,
                         expense, income, debt_out, debt_in, adjustment, reversal, deposit, withdrawal)
  reverses_entry_id NULL,
  occurred_at, created_at, created_by
)
```

### كيف تُحسب الأرقام (كلها مشتقة)

للعملية التجارية نخزّن مُدخلين فقط، والباقي يُحسب:
- `amount` = قيمة العملية الأصلية
- `customer_paid` = ما دفعه العميل لي
- `provider_charged` = ما خصمه المزود مني

```
ربح العملية (gross)   = customer_paid − amount          → 1030 − 1000 = 30
عمولة الشركة         = provider_charged − amount        → 1010 − 1000 = 10
الربح الصافي          = customer_paid − provider_charged → 1030 − 1010 = 20
```
القيود: `+1030` على حساب الاستلام، `−1010` على حساب الدفع.
تحقق ذاتي: **التغير في إجمالي الأموال = الربح الصافي** (20). أي اختلاف يعني خطأ ويُرفض بـConstraint/اختبار.

| الحالة | الأثر |
|---|---|
| تحويل بين محافظ | قيدان (−/+) بنفس القيمة، نوع `transfer`، خارج كل تقارير الربح والمصروف |
| مصروف شخصي/عمل | قيد سالب + `expense_scope` (personal/business) + تصنيف |
| دين لي (أقرضت) | قيد سالب من حساب + سجل Debt (receivable) |
| سداد دين | قيد موجب + DebtPayment، المتبقي = الأصل − المدفوع |
| دين عليّ (اقترضت) | قيد موجب + Debt (payable) |
| تسوية | الفرق = الفعلي − المحسوب → قيد `adjustment` مع سبب إلزامي |
| استرداد/إلغاء | قيود عكسية لكل قيود العملية الأصلية، الحالة تتغير، السجل الأصلي يبقى |

**إجمالي الأموال** = مجموع `SUM(amount × سعر اليوم)` لكل الحسابات إلى EGP (تقييم حالي).
**الأرباح والمصاريف التاريخية** = مجموع `base_amount` المجمّد (لا تتأثر بتغير الصرف لاحقًا).
**صافي الثروة** = إجمالي الأموال + المستحق لي − المستحق عليّ، مع `networth_snapshots` يومي لعرض التطور.

## 6. حالات العملية

`pending → completed` | `pending → failed` | `completed → refunded` | `pending/completed → cancelled`
- الانتقالات المسموحة فقط تُفرض في State Machine واحدة.
- `completed` تنشئ القيود. `refunded/cancelled` تنشئ القيود العكسية.
- `failed` لا أثر مالي. لا رجوع من `refunded/cancelled`.
- تعديل المبلغ بعد الاكتمال = عكس القيود القديمة + قيود جديدة + سطر Audit (بالقيمة القديمة والجديدة والسبب).

## 7. Audit Log

```
audit_logs(id, workspace_id, user_id, device_id, ip, action, entity_type, entity_id,
           old_value JSONB, new_value JSONB, reason, created_at, prev_hash, hash)
```
- Append-only بـTrigger (ممنوع UPDATE/DELETE).
- **Hash chain**: كل سطر يحتوي hash السطر السابق، فأي تلاعب يُكتشف بأمر تحقق واحد.
- يُسجَّل: تعديل/إلغاء/استرداد، تسويات، تغيير إعدادات، دخول، تغيير PIN/2FA، تصدير، استعادة نسخة.

## 8. Database Schema (مختصر العلاقات)

```
workspaces 1─* users 1─* sessions/devices
workspaces 1─* accounts(account_type_id→account_types, currency)
workspaces 1─* parties (type: customer | supplier | provider)   ← جدول واحد بدل Customers+Suppliers+Providers
workspaces 1─* services(provider_id→parties)
workspaces 1─* categories(scope: personal|business|income, parent_id)
transactions(id, number, type, status, party_id, service_id, provider_id,
             amount, customer_paid, provider_charged, currency, fx_rate,
             from_account_id, to_account_id, category_id, expense_scope, note, occurred_at)
   1─* ledger_entries
   1─* transaction_events (Timeline)
debts(id, party_id, direction receivable|payable, principal, currency, status, due_date, origin_transaction_id)
   1─* debt_payments(id, debt_id, amount, ledger_transaction_id)
balance_adjustments(id, account_id, computed, actual, difference, reason, transaction_id)
recurring_rules(id, template JSONB, frequency, day, mode auto|remind, next_run_at, active)
exchange_rates(id, from_ccy, to_ccy, rate, effective_at)   -- تاريخي، لا يُحدَّث بل يُضاف
goals(id, name, target, currency, linked_account_ids / manual_contribs)
networth_snapshots(date, total_assets, receivables, payables, net_worth)
notifications(id, type, payload, read_at, created_at)
audit_logs, settings, backups
```
دمج Expenses وIncome وTransfers داخل `transactions` (بنوع مختلف) يمنع تكرار البيانات ويجعل البحث والتقارير موحّدة. الجداول المقترحة منك تتحول إلى Views عند الحاجة.

Constraints أساسية:
- `CHECK(amount > 0)` في العمليات، والإشارة تحددها قيود الـLedger.
- مجموع قيود التحويل الداخلي بعد التحويل إلى EGP = 0 (للعملة الواحدة).
- لا قيد على حساب موقوف.
- Foreign keys بدون CASCADE DELETE على أي بيانات مالية (حذف ناعم `archived_at` فقط).

## 9. API Endpoints (REST، كلها تحت `/api/v1` وتتطلب جلسة)

```
Auth      POST /auth/login | /auth/logout | /auth/2fa/setup | /auth/2fa/verify | /auth/pin
          GET  /auth/sessions | DELETE /auth/sessions/:id
Accounts  GET/POST /accounts | GET/PATCH /accounts/:id | GET /accounts/:id/statement
Tx        GET /transactions (بحث+فلاتر+ترقيم) | POST /transactions | GET /transactions/:id
          POST /transactions/:id/complete | /fail | /cancel | /refund | /amend
          POST /transfers
Expenses  POST /expenses (scope=personal|business) | GET /expenses
Debts     GET/POST /debts | POST /debts/:id/payments
Adjust    POST /accounts/:id/reconcile
Parties   GET/POST/PATCH /customers | /providers | /suppliers ; GET /customers/:id/history
Recurring GET/POST/PATCH /recurring | POST /recurring/:id/run
Goals     GET/POST/PATCH /goals
Reports   GET /dashboard?range= | /reports/profit | /expenses | /wallets | /summary | /networth
          GET /reports/*/export?format=xlsx|csv|pdf
Charts    GET /charts/{daily-profit,monthly-profit,expenses,distribution,growth,top-services}
Notif     GET /notifications | POST /notifications/:id/read | rules CRUD
FX        GET/POST /exchange-rates
Backup    POST /backup | GET /backups | POST /backup/restore (PIN + 2FA)
Audit     GET /audit-logs (قراءة فقط)
```
كل Endpoint: Zod validation، Rate limit، تفويض بالدور، وكل عملية مالية داخل DB Transaction واحدة مع **Idempotency-Key** لمنع التكرار عند ضعف الشبكة.

## 10. صفحات الواجهة

1. Dashboard (بطاقات مختصرة + محدد الفترة + مخطط واحد رئيسي)
2. العمليات (قائمة + بحث + فلاتر) / تفاصيل العملية مع Timeline
3. زر عائم "+ عملية جديدة" → اختيار النوع → نموذج مخصص لكل نوع
4. الحسابات والمحافظ (+ كشف حساب + تسوية)
5. العملاء والمزودون
6. الديون
7. المصاريف (شخصية | عمل)
8. المتكررة
9. التقارير والرسوم البيانية
10. الأهداف المالية
11. صافي الثروة
12. الإشعارات
13. الإعدادات (العملات والصرف، التصنيفات، الأمان، الأجهزة، النسخ الاحتياطي، Audit Log)

التصميم: Bottom Navigation على الهاتف، عمل بيد واحدة، RTL، إخفاء الكسور اختياريًا، وضع داكن.

## 11. خطة التنفيذ (مراحل، وكل مرحلة تنتهي باختبارات حسابية)

| المرحلة | المحتوى | معيار القبول |
|---|---|---|
| 0 | هيكل المشروع، Docker، Migrations، CI | يعمل محليًا |
| 1 | Schema + Ledger + Triggers (منع التعديل/الحذف) + Money utilities | اختبار Append-only، دقة الأرقام |
| 2 | المنطق المالي: عمليات، تحويلات، مصاريف، ديون، تسويات، استرداد/إلغاء، عملات | **سيناريوهاتك التسعة + المثال النهائي (54,850)** تنجح |
| 3 | Auth + Security + Audit hash chain + صلاحيات | اختبارات أمان |
| 4 | API كامل + Reports + Dashboard queries + Export | تطابق التقارير مع الأرصدة |
| 5 | الواجهة (PWA) | اختبار على Android/iPhone |
| 6 | Recurring، Notifications، Goals، Net Worth، Backup/Restore | |
| 7 | **Reconciliation test شامل**: مجموع كل التقارير = الأرصدة، Property-based tests على عمليات عشوائية، ثم Hardening ونشر | لا يُعتبر المشروع مكتملًا قبله |

اختبار التطابق النهائي (Invariants) يُشغَّل آليًا:
- `Σ أرصدة الحسابات (EGP) = رصيد البداية + الدخل + الربح الصافي − المصاريف ± التسويات`
- `Σ قيود التحويلات الداخلية = 0`
- `Σ التقارير = Σ الـLedger` لأي فترة.

## 12. نقاط تحتاج قرارك (لها افتراض افتراضي)

1. **مستخدم واحد أم فريق؟** الافتراض: مستخدم واحد (owner) والبنية تدعم التوسع.
2. **الاستضافة:** الافتراض Docker على VPS خاص بك (بياناتك المالية عندك).
3. **تقييم الـUSDT والعملات:** الافتراض إدخال سعر الصرف يدويًا مع سجل تاريخي (يمكن لاحقًا ربطه بمصدر خارجي).
4. **العمليات المعلقة:** الافتراض ألا تؤثر على الرصيد حتى تكتمل.
