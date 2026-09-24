const KEY_EXPENSES = "expenses_data";
const KEY_BUDGETS = "budgets_data";
const KEY_RECURRING = "recurring_data";
const KEY_THEME = "theme";

const MAX_NOTE_LENGTH = 2000;
const MAX_EXPENSES = 5000;
const MAX_CATEGORY_NAME_LENGTH = 40;
const MAX_CATEGORIES = 40;
const MAX_RECURRING_TEMPLATES = 100;
const RECURRING_CATCHUP_MONTHS_CAP = 24;
const SERIES_COUNT = 8;
const MIN_SUBMIT_INTERVAL = 500;

const RECEIPT_MAX_RAW_BYTES = 8 * 1024 * 1024;
const RECEIPT_MAX_DIMENSION = 1000;
const RECEIPT_JPEG_QUALITY = 0.7;
const RECEIPT_MAX_BYTES = 400 * 1024;
const SOFT_STORAGE_WARN_BYTES = 4.5 * 1024 * 1024;

const PAYMENT_METHODS = ["Cash", "Debit Card", "Credit Card", "Bank Transfer", "Other"];

const DEFAULT_CATEGORY_NAMES = [
  "Groceries", "Dining", "Transport", "Housing",
  "Utilities", "Entertainment", "Health", "Shopping",
];

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

function generateChecksum(data) {
  return simpleHash(JSON.stringify(data));
}

function generateId() {
  return Date.now() + crypto.getRandomValues(new Uint32Array(1))[0];
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentYearMonth() {
  return todayStr().slice(0, 7);
}

function shiftYearMonth(yearMonth, delta) {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function compareYearMonth(a, b) {
  return a.localeCompare(b);
}

function daysInMonth(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function clampDayForMonth(yearMonth, day) {
  return Math.min(Math.max(1, day), daysInMonth(yearMonth));
}

function isValidDate(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  return !isNaN(d.getTime());
}

function centsToStr(cents) {
  return (cents / 100).toFixed(2);
}

function strToCents(str) {
  const n = Number(str);
  if (!isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100);
}

function csvEscape(field) {
  const str = String(field ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function allCategoryNames(categories) {
  return [...categories.map((c) => c.name), "Other"];
}

function colorSlotForCategory(categories, name) {
  const cat = categories.find((c) => c.name === name);
  return cat && Number.isInteger(cat.colorSlot) ? cat.colorSlot : null;
}

function nextColorSlot(categories) {
  const used = new Set(categories.map((c) => c.colorSlot).filter((s) => Number.isInteger(s)));
  for (let i = 0; i < SERIES_COUNT; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

function swatchClass(colorSlot) {
  return Number.isInteger(colorSlot) ? `slot-${colorSlot}` : "slot-other";
}

function defaultBudgetsData() {
  return {
    version: 1,
    categories: DEFAULT_CATEGORY_NAMES.map((name, i) => ({ name, colorSlot: i })),
    budgets: {},
    currency: "USD",
  };
}

function migrateExpense(raw, categoryNames) {
  if (!raw || typeof raw !== "object") return null;
  const amountCents = typeof raw.amountCents === "number" && isFinite(raw.amountCents)
    ? Math.round(raw.amountCents)
    : NaN;
  if (!isFinite(amountCents) || amountCents <= 0) return null;
  if (!isValidDate(raw.date)) return null;

  const category = typeof raw.category === "string" && categoryNames.includes(raw.category)
    ? raw.category
    : "Other";
  const paymentMethod = PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : "Other";
  const note = typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE_LENGTH) : "";

  let receipt = null;
  if (raw.receipt && typeof raw.receipt === "object" && typeof raw.receipt.dataUrl === "string"
      && raw.receipt.dataUrl.startsWith("data:image/")) {
    receipt = {
      dataUrl: raw.receipt.dataUrl,
      type: typeof raw.receipt.type === "string" ? raw.receipt.type : "image/jpeg",
      width: Number(raw.receipt.width) || 0,
      height: Number(raw.receipt.height) || 0,
      sizeBytes: Number(raw.receipt.sizeBytes) || 0,
      originalName: typeof raw.receipt.originalName === "string" ? raw.receipt.originalName.slice(0, 200) : "",
    };
  }

  const id = typeof raw.id === "number" && isFinite(raw.id) ? raw.id : generateId();
  const createdAt = typeof raw.createdAt === "number" && isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const recurringId = typeof raw.recurringId === "number" && isFinite(raw.recurringId) ? raw.recurringId : undefined;

  const expense = { id, amountCents, date: raw.date, category, paymentMethod, note, receipt, createdAt };
  if (recurringId !== undefined) expense.recurringId = recurringId;
  return expense;
}

function sanitizeExpensesList(rawList, categoryNames) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((e) => migrateExpense(e, categoryNames)).filter(Boolean);
}

function loadExpenses(categoryNames) {
  try {
    const stored = localStorage.getItem(KEY_EXPENSES);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return [];
    if (!Array.isArray(parsed.expenses)) return [];
    if (parsed.checksum && parsed.checksum !== generateChecksum(parsed.expenses)) {
      console.warn("Expense data integrity check failed; loaded anyway");
    }
    return sanitizeExpensesList(parsed.expenses, categoryNames);
  } catch {
    return [];
  }
}

function saveExpenses(expenses) {
  try {
    if (expenses.length > MAX_EXPENSES) {
      showToast(`Cannot save: exceeded ${MAX_EXPENSES} expense limit`);
      return false;
    }
    const checksum = generateChecksum(expenses);
    const json = JSON.stringify({ version: 1, expenses, checksum });
    if (json.length > SOFT_STORAGE_WARN_BYTES) {
      showToast("Storage is getting full — consider removing old receipts");
    }
    localStorage.setItem(KEY_EXPENSES, json);
    return true;
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      showToast("Storage full: cannot save more expenses or receipts");
    }
    return false;
  }
}

function sanitizeBudgetsData(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
    return defaultBudgetsData();
  }

  const seen = new Set();
  const categories = parsed.categories
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({ name: c.name.trim().slice(0, MAX_CATEGORY_NAME_LENGTH), colorSlot: Number.isInteger(c.colorSlot) ? c.colorSlot : null }))
    .filter((c) => {
      if (c.name === "Other" || seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    })
    .slice(0, MAX_CATEGORIES);

  const budgets = {};
  if (parsed.budgets && typeof parsed.budgets === "object") {
    const names = new Set(categories.map((c) => c.name));
    for (const [k, v] of Object.entries(parsed.budgets)) {
      if (names.has(k) && typeof v === "number" && isFinite(v) && v > 0) budgets[k] = Math.round(v);
    }
  }

  const currency = typeof parsed.currency === "string" && /^[A-Za-z]{3}$/.test(parsed.currency)
    ? parsed.currency.toUpperCase()
    : "USD";

  return {
    version: 1,
    categories: categories.length ? categories : defaultBudgetsData().categories,
    budgets,
    currency,
  };
}

function loadBudgets() {
  try {
    const stored = localStorage.getItem(KEY_BUDGETS);
    if (!stored) return defaultBudgetsData();
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
      return defaultBudgetsData();
    }
    const payload = { categories: parsed.categories, budgets: parsed.budgets, currency: parsed.currency };
    if (parsed.checksum && parsed.checksum !== generateChecksum(payload)) {
      console.warn("Budget data integrity check failed; loaded anyway");
    }
    return sanitizeBudgetsData(parsed);
  } catch {
    return defaultBudgetsData();
  }
}

function saveBudgets(budgetsData) {
  try {
    const payload = { categories: budgetsData.categories, budgets: budgetsData.budgets, currency: budgetsData.currency };
    const checksum = generateChecksum(payload);
    localStorage.setItem(KEY_BUDGETS, JSON.stringify({ version: 1, ...payload, checksum }));
    return true;
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      showToast("Storage full: cannot save budgets");
    }
    return false;
  }
}

function defaultRecurringData() {
  return { version: 1, templates: [] };
}

function migrateRecurringTemplate(raw, categoryNames) {
  if (!raw || typeof raw !== "object") return null;
  const amountCents = typeof raw.amountCents === "number" && isFinite(raw.amountCents)
    ? Math.round(raw.amountCents)
    : NaN;
  if (!isFinite(amountCents) || amountCents <= 0) return null;
  if (!isValidDate(raw.startDate)) return null;

  const category = typeof raw.category === "string" && categoryNames.includes(raw.category) ? raw.category : "Other";
  const paymentMethod = PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : "Other";
  const note = typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE_LENGTH) : "";
  const dayOfMonth = Number.isInteger(raw.dayOfMonth) && raw.dayOfMonth >= 1 && raw.dayOfMonth <= 31 ? raw.dayOfMonth : 1;
  const active = raw.active !== false;
  const id = typeof raw.id === "number" && isFinite(raw.id) ? raw.id : generateId();
  const lastGeneratedMonth = typeof raw.lastGeneratedMonth === "string" && /^\d{4}-\d{2}$/.test(raw.lastGeneratedMonth)
    ? raw.lastGeneratedMonth
    : null;

  return {
    id,
    amountCents,
    category,
    paymentMethod,
    note,
    frequency: "monthly",
    dayOfMonth,
    startDate: raw.startDate,
    active,
    lastGeneratedMonth,
  };
}

function sanitizeRecurringList(rawList, categoryNames) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((t) => migrateRecurringTemplate(t, categoryNames)).filter(Boolean).slice(0, MAX_RECURRING_TEMPLATES);
}

function loadRecurring(categoryNames) {
  try {
    const stored = localStorage.getItem(KEY_RECURRING);
    if (!stored) return defaultRecurringData();
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.templates)) return defaultRecurringData();
    if (parsed.checksum && parsed.checksum !== generateChecksum(parsed.templates)) {
      console.warn("Recurring data integrity check failed; loaded anyway");
    }
    return { version: 1, templates: sanitizeRecurringList(parsed.templates, categoryNames) };
  } catch {
    return defaultRecurringData();
  }
}

function saveRecurring(recurringData) {
  try {
    const checksum = generateChecksum(recurringData.templates);
    localStorage.setItem(KEY_RECURRING, JSON.stringify({ version: 1, templates: recurringData.templates, checksum }));
    return true;
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      showToast("Storage full: cannot save recurring expenses");
    }
    return false;
  }
}
