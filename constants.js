export const BASE = 'EGP';
export const DEFAULT_CURRENCIES = ['EGP', 'USD', 'AED', 'USDT'];

export const ACCOUNT_TYPES = { wallet: 'محفظة', bank: 'بنك', cash: 'كاش', crypto: 'عملات رقمية', other: 'أخرى' };

// family: trade = commercial op with commission, money = single-account op, ...
export const TX = {
  sell: { label: 'بيع', family: 'trade' },
  buy: { label: 'شراء', family: 'trade' },
  transfer: { label: 'تحويل', family: 'trade' },
  topup: { label: 'شحن', family: 'trade' },
  cashout: { label: 'سحب', family: 'trade' },
  income: { label: 'دخل', family: 'single' },
  expense_personal: { label: 'مصروف شخصي', family: 'single' },
  expense_business: { label: 'مصروف عمل', family: 'single' },
  deposit: { label: 'إيداع', family: 'single' },
  withdrawal: { label: 'سحب من الحساب', family: 'single' },
  debt_to_me: { label: 'دين لي', family: 'debt' },
  debt_on_me: { label: 'دين عليّ', family: 'debt' },
  debt_payment: { label: 'سداد دين', family: 'debt' },
  internal_transfer: { label: 'تحويل بين المحافظ', family: 'internal' },
  adjustment: { label: 'تسوية رصيد', family: 'adjustment' },
  opening: { label: 'رصيد افتتاحي', family: 'system' },
};
export const isTrade = (t) => TX[t]?.family === 'trade';

export const STATUS = {
  completed: { label: 'مكتملة', icon: '🟢' },
  pending: { label: 'معلقة', icon: '🟡' },
  failed: { label: 'فاشلة', icon: '🔴' },
  refunded: { label: 'مستردة', icon: '↩️' },
  cancelled: { label: 'ملغاة', icon: '⚪' },
};
export const TRANSITIONS = {
  pending: ['completed', 'failed', 'cancelled'],
  completed: ['refunded', 'cancelled'],
  failed: [], refunded: [], cancelled: [],
};

// Ledger entry kinds → report bucket. Every kind MUST map to exactly one bucket (checked by integrity).
export const KIND = {
  opening: 'opening',
  trade_in: 'profit', trade_out: 'profit',
  memo_volume: 'memo', memo_gross: 'memo', memo_commission: 'memo',
  transfer_in: 'transfer', transfer_out: 'transfer',
  income: 'income', expense: 'expense',
  deposit: 'deposit', withdrawal: 'withdrawal',
  loan_out: 'debt', loan_repaid_in: 'debt', borrow_in: 'debt', borrow_repaid_out: 'debt',
  adjustment: 'adjustment',
};

export const DEFAULT_CATEGORIES = {
  personal: ['أكل', 'مواصلات', 'ملابس', 'خروج', 'ترفيه', 'هاتف', 'إنترنت', 'صحة', 'عائلة', 'مشتريات', 'سفر', 'تعليم', 'أخرى'],
  business: ['VPS', 'Domain', 'Hosting', 'إعلانات', 'شراء خدمات', 'برامج', 'اشتراكات', 'عمولات', 'أدوات', 'مصاريف تشغيل', 'أخرى'],
  income: ['راتب', 'عمل إضافي', 'هدية', 'دخل آخر'],
};

// Operations that need the PIN in the UI.
export const SENSITIVE = ['amend', 'cancel', 'refund', 'reconcile', 'export', 'restore', 'security'];
