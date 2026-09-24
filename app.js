let budgetsData = loadBudgets();
let expenses = loadExpenses(allCategoryNames(budgetsData.categories));
let recurringData = loadRecurring(allCategoryNames(budgetsData.categories));

let dateFrom = "";
let dateTo = "";
let categoryFilter = "all";
let query = "";
let sortMode = "date-desc";
let dashboardMonth = currentYearMonth();
let chartView = "chart";
let undoSnapshot = null;
let undoBudgetsSnapshot = null;
let undoRecurringSnapshot = null;
let toastTimer = null;
let pendingReceipt = null;
let lastSubmitTime = 0;

const themeToggle = document.getElementById("theme-toggle");

const monthPrev = document.getElementById("month-prev");
const monthLabel = document.getElementById("month-label");
const monthNext = document.getElementById("month-next");
const statTotal = document.getElementById("stat-total");
const statDelta = document.getElementById("stat-delta");
const trendChartContainer = document.getElementById("trend-chart-container");
const chartViewToggle = document.getElementById("chart-view-toggle");
const categoryChartContainer = document.getElementById("category-chart-container");
const categoryTableContainer = document.getElementById("category-table-container");
const budgetMetersContainer = document.getElementById("budget-meters-container");

const categoryBudgetList = document.getElementById("category-budget-list");
const addCategoryForm = document.getElementById("add-category-form");
const categoryNameInput = document.getElementById("category-name-input");
const currencyInput = document.getElementById("currency-input");

const recurringList = document.getElementById("recurring-list");
const addRecurringForm = document.getElementById("add-recurring-form");
const recurringAmountInput = document.getElementById("recurring-amount-input");
const recurringCategoryInput = document.getElementById("recurring-category-input");
const recurringPaymentInput = document.getElementById("recurring-payment-input");
const recurringDayInput = document.getElementById("recurring-day-input");
const recurringNoteInput = document.getElementById("recurring-note-input");

const addForm = document.getElementById("add-form");
const amountInput = document.getElementById("amount-input");
const dateInput = document.getElementById("date-input");
const categoryInput = document.getElementById("category-input");
const paymentInput = document.getElementById("payment-input");
const noteInput = document.getElementById("note-input");
const receiptInput = document.getElementById("receipt-input");
const receiptPreview = document.getElementById("receipt-preview");
const receiptPreviewImg = document.getElementById("receipt-preview-img");
const receiptRemoveBtn = document.getElementById("receipt-remove");

const searchInput = document.getElementById("search");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const categoryFilterSelect = document.getElementById("category-filter");
const sortSelect = document.getElementById("sort");

const list = document.getElementById("list");
const count = document.getElementById("count");
const exportBtn = document.getElementById("export");
const backupBtn = document.getElementById("backup");
const restoreBtn = document.getElementById("restore");
const restoreFileInput = document.getElementById("restore-file");

const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toast-msg");
const undoBtn = document.getElementById("undo");

let currencyFormatter = makeCurrencyFormatter(budgetsData.currency);

function makeCurrencyFormatter(currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency });
  } catch {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
  }
}

function formatAmount(cents) {
  return currencyFormatter.format(cents / 100);
}

function formatMonthLabel(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function computeMonthlyTotal(list, yearMonth) {
  return list.filter((e) => e.date.startsWith(yearMonth)).reduce((sum, e) => sum + e.amountCents, 0);
}

function computeCategoryBreakdown(list, yearMonth, categories) {
  const monthExpenses = list.filter((e) => e.date.startsWith(yearMonth));
  const total = monthExpenses.reduce((s, e) => s + e.amountCents, 0);
  const byLabel = new Map();
  for (const e of monthExpenses) {
    const slot = colorSlotForCategory(categories, e.category);
    const label = Number.isInteger(slot) ? e.category : "Other";
    if (!byLabel.has(label)) byLabel.set(label, { label, colorSlot: Number.isInteger(slot) ? slot : null, amountCents: 0 });
    byLabel.get(label).amountCents += e.amountCents;
  }
  const rows = [...byLabel.values()].map((r) => ({
    ...r,
    percent: total > 0 ? Math.round((r.amountCents / total) * 100) : 0,
  }));
  rows.sort((a, b) => b.amountCents - a.amountCents);
  return { rows, total };
}

function formatMonthShortLabel(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function computeMonthlyTrend(list, endYearMonth, monthsCount) {
  const rows = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const ym = shiftYearMonth(endYearMonth, -i);
    rows.push({
      yearMonth: ym,
      label: formatMonthShortLabel(ym),
      totalCents: computeMonthlyTotal(list, ym),
      isCurrent: ym === endYearMonth,
    });
  }
  return rows;
}

function computeBudgetComparison(categories, budgets, list, yearMonth) {
  const monthExpenses = list.filter((e) => e.date.startsWith(yearMonth));
  const rows = [];
  for (const cat of categories) {
    const budgetCents = budgets[cat.name];
    if (!budgetCents) continue;
    const actualCents = monthExpenses
      .filter((e) => e.category === cat.name)
      .reduce((s, e) => s + e.amountCents, 0);
    rows.push({ label: cat.name, colorSlot: cat.colorSlot, budgetCents, actualCents });
  }
  rows.sort((a, b) => b.actualCents / b.budgetCents - a.actualCents / a.budgetCents);
  return rows;
}

function visibleExpenses() {
  const q = query.trim().toLowerCase();
  const visible = expenses.filter(
    (e) =>
      (!dateFrom || e.date >= dateFrom) &&
      (!dateTo || e.date <= dateTo) &&
      (categoryFilter === "all" || e.category === categoryFilter) &&
      (!q ||
        e.category.toLowerCase().includes(q) ||
        e.paymentMethod.toLowerCase().includes(q) ||
        (e.note || "").toLowerCase().includes(q))
  );
  if (sortMode === "date-desc") visible.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  else if (sortMode === "date-asc") visible.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  else if (sortMode === "amount-desc") visible.sort((a, b) => b.amountCents - a.amountCents);
  else if (sortMode === "amount-asc") visible.sort((a, b) => a.amountCents - b.amountCents);
  return visible;
}

function populateCategorySelects() {
  const names = allCategoryNames(budgetsData.categories);

  const prevCategory = categoryInput.value;
  categoryInput.textContent = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    categoryInput.append(opt);
  }
  categoryInput.value = names.includes(prevCategory) ? prevCategory : names[0];

  const prevRecurringCategory = recurringCategoryInput.value;
  recurringCategoryInput.textContent = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    recurringCategoryInput.append(opt);
  }
  recurringCategoryInput.value = names.includes(prevRecurringCategory) ? prevRecurringCategory : names[0];

  const prevFilter = categoryFilterSelect.value;
  categoryFilterSelect.textContent = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All categories";
  categoryFilterSelect.append(allOpt);
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    categoryFilterSelect.append(opt);
  }
  categoryFilterSelect.value = [...categoryFilterSelect.options].some((o) => o.value === prevFilter)
    ? prevFilter
    : "all";
}

function populatePaymentSelect() {
  for (const select of [paymentInput, recurringPaymentInput]) {
    for (const m of PAYMENT_METHODS) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.append(opt);
    }
  }
}

function renderCategoryBudgetList() {
  categoryBudgetList.textContent = "";
  for (const cat of budgetsData.categories) {
    const row = document.createElement("div");
    row.className = "category-budget-row";
    row.dataset.category = cat.name;

    const swatch = document.createElement("span");
    swatch.className = "swatch " + swatchClass(cat.colorSlot);
    row.append(swatch);

    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = cat.name;
    row.append(name);

    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.placeholder = "No budget";
    input.className = "budget-input";
    input.setAttribute("aria-label", `Monthly budget for ${cat.name}`);
    if (budgetsData.budgets[cat.name]) input.value = centsToStr(budgetsData.budgets[cat.name]);
    row.append(input);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "cat-rename";
    renameBtn.title = "Rename category";
    renameBtn.setAttribute("aria-label", `Rename ${cat.name}`);
    renameBtn.textContent = "✏️";
    row.append(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "cat-delete";
    deleteBtn.title = "Delete category";
    deleteBtn.setAttribute("aria-label", `Delete ${cat.name}`);
    deleteBtn.textContent = "×";
    row.append(deleteBtn);

    categoryBudgetList.append(row);
  }
}

function formatRecurringDesc(tpl) {
  const parts = [tpl.category, tpl.paymentMethod, `day ${tpl.dayOfMonth} of month`];
  if (tpl.note) parts.push(tpl.note);
  return parts.join(" · ");
}

function renderRecurringList() {
  recurringList.textContent = "";
  if (!recurringData.templates.length) {
    const empty = document.createElement("div");
    empty.className = "recurring-empty";
    empty.textContent = "No recurring expenses set up yet.";
    recurringList.append(empty);
    return;
  }
  for (const tpl of recurringData.templates) {
    const row = document.createElement("div");
    row.className = "recurring-row" + (tpl.active ? "" : " paused");
    row.dataset.id = tpl.id;

    const amount = document.createElement("span");
    amount.className = "recurring-amount";
    amount.textContent = formatAmount(tpl.amountCents);
    row.append(amount);

    const desc = document.createElement("span");
    desc.className = "recurring-desc";
    desc.textContent = formatRecurringDesc(tpl) + (tpl.active ? "" : " · paused");
    row.append(desc);

    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "recurring-pause";
    pauseBtn.textContent = tpl.active ? "Pause" : "Resume";
    row.append(pauseBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "recurring-delete";
    deleteBtn.title = "Delete";
    deleteBtn.setAttribute("aria-label", "Delete recurring expense");
    deleteBtn.textContent = "×";
    row.append(deleteBtn);

    recurringList.append(row);
  }
}

function renderCategoryTable(rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const [text, cls] of [["Category", ""], ["Amount", "num"], ["% of total", "num"]]) {
    const th = document.createElement("th");
    if (cls) th.className = cls;
    th.textContent = text;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    const swatch = document.createElement("span");
    swatch.className = "swatch " + swatchClass(row.colorSlot);
    nameCell.append(swatch, document.createTextNode(row.label));
    tr.append(nameCell);

    const amountCell = document.createElement("td");
    amountCell.className = "num";
    amountCell.textContent = formatAmount(row.amountCents);
    tr.append(amountCell);

    const pctCell = document.createElement("td");
    pctCell.className = "num";
    pctCell.textContent = `${row.percent}%`;
    tr.append(pctCell);

    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function renderCategoryChart(rows) {
  categoryChartContainer.textContent = "";
  categoryTableContainer.textContent = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "dashboard-empty";
    empty.textContent = "No expenses this month yet.";
    categoryChartContainer.append(empty);
    categoryTableContainer.append(empty.cloneNode(true));
  } else {
    categoryChartContainer.append(renderCategoryBarChart(rows, formatAmount));
    categoryTableContainer.append(renderCategoryTable(rows));
  }

  categoryChartContainer.hidden = chartView !== "chart";
  categoryTableContainer.hidden = chartView !== "table";
}

function renderStatDelta(totalCents, prevTotalCents) {
  statDelta.textContent = "";
  statDelta.className = "stat-delta";
  if (prevTotalCents <= 0) return;
  const diff = totalCents - prevTotalCents;
  const pct = Math.round((diff / prevTotalCents) * 100);
  if (pct === 0) {
    statDelta.textContent = "Same as last month";
    return;
  }
  statDelta.classList.add(pct > 0 ? "up" : "down");
  statDelta.textContent = `${pct > 0 ? "+" : ""}${pct}% vs last month`;
}

function renderDashboard() {
  monthLabel.textContent = formatMonthLabel(dashboardMonth);

  const totalCents = computeMonthlyTotal(expenses, dashboardMonth);
  statTotal.textContent = formatAmount(totalCents);
  renderStatDelta(totalCents, computeMonthlyTotal(expenses, shiftYearMonth(dashboardMonth, -1)));

  const trendRows = computeMonthlyTrend(expenses, dashboardMonth, 6);
  trendChartContainer.textContent = "";
  trendChartContainer.append(renderTrendChart(trendRows, formatAmount));

  const { rows: breakdownRows } = computeCategoryBreakdown(expenses, dashboardMonth, budgetsData.categories);
  renderCategoryChart(breakdownRows);

  const budgetRows = computeBudgetComparison(budgetsData.categories, budgetsData.budgets, expenses, dashboardMonth);
  budgetMetersContainer.textContent = "";
  if (!budgetRows.length) {
    const empty = document.createElement("div");
    empty.className = "dashboard-empty";
    empty.textContent = "No budgets set yet. Set one below to track spending against it.";
    budgetMetersContainer.append(empty);
  } else {
    budgetMetersContainer.append(renderBudgetMeters(budgetRows, formatAmount));
  }
}

function createExpenseElement(e) {
  const li = document.createElement("li");
  li.dataset.id = e.id;

  const amount = document.createElement("span");
  amount.className = "amount";
  amount.textContent = formatAmount(e.amountCents);
  li.append(amount);

  const date = document.createElement("span");
  date.className = "date";
  date.textContent = e.date;
  li.append(date);

  const category = document.createElement("span");
  category.className = "category";
  const swatch = document.createElement("span");
  swatch.className = "swatch " + swatchClass(colorSlotForCategory(budgetsData.categories, e.category));
  category.append(swatch, document.createTextNode(e.category));
  li.append(category);

  const payment = document.createElement("span");
  payment.className = "payment";
  payment.textContent = e.paymentMethod;
  li.append(payment);

  if (e.recurringId) {
    const badge = document.createElement("span");
    badge.className = "recurring-badge";
    badge.title = "Generated from a recurring expense";
    badge.textContent = "↻";
    li.append(badge);
  }

  if (e.receipt) {
    const receiptBtn = document.createElement("button");
    receiptBtn.type = "button";
    receiptBtn.className = "receipt-btn";
    receiptBtn.title = "View receipt";
    receiptBtn.setAttribute("aria-label", "View receipt");
    receiptBtn.textContent = "🖼️";
    li.append(receiptBtn);
  }

  const pen = document.createElement("button");
  pen.type = "button";
  pen.className = "pen";
  pen.title = "Edit";
  pen.setAttribute("aria-label", "Edit expense");
  pen.textContent = "✏️";
  li.append(pen);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.title = "Delete";
  del.setAttribute("aria-label", "Delete expense");
  del.textContent = "×";
  li.append(del);

  if (e.note) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = e.note;
    li.append(note);
  }

  return li;
}

function renderList() {
  list.textContent = "";
  const visible = visibleExpenses();
  for (const e of visible) {
    list.append(createExpenseElement(e));
  }
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = expenses.length ? "No expenses match the current filters." : "No expenses logged yet.";
    list.append(empty);
  }
  const totalCents = visible.reduce((s, e) => s + e.amountCents, 0);
  count.textContent = `${visible.length} expense${visible.length === 1 ? "" : "s"} — ${formatAmount(totalCents)}`;
}

function render() {
  populateCategorySelects();
  renderCategoryBudgetList();
  renderRecurringList();
  renderDashboard();
  renderList();
}

function update() {
  saveExpenses(expenses);
  render();
}

function updateBudgets() {
  saveBudgets(budgetsData);
  currencyFormatter = makeCurrencyFormatter(budgetsData.currency);
  render();
}

function cloneData(x) {
  return JSON.parse(JSON.stringify(x));
}

function persistAll() {
  saveExpenses(expenses);
  saveBudgets(budgetsData);
  saveRecurring(recurringData);
  currencyFormatter = makeCurrencyFormatter(budgetsData.currency);
  render();
}

function showToast(message) {
  toastMsg.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  toast.hidden = true;
  undoSnapshot = null;
  undoBudgetsSnapshot = null;
  undoRecurringSnapshot = null;
  clearTimeout(toastTimer);
}

undoBtn.addEventListener("click", () => {
  if (!undoSnapshot) return;
  expenses = undoSnapshot;
  const restoredBudgets = undoBudgetsSnapshot;
  const restoredRecurring = undoRecurringSnapshot;
  hideToast();
  if (restoredBudgets || restoredRecurring) {
    if (restoredBudgets) budgetsData = restoredBudgets;
    if (restoredRecurring) recurringData = restoredRecurring;
    persistAll();
  } else {
    update();
  }
});

function processReceiptFile(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      showToast("Receipt must be an image file");
      resolve(null);
      return;
    }
    if (file.size > RECEIPT_MAX_RAW_BYTES) {
      showToast("Receipt image is too large");
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      showToast("Could not read that image");
      resolve(null);
    };
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => {
        showToast("Could not read that image");
        resolve(null);
      };
      img.onload = () => {
        let { width, height } = img;
        if (width > RECEIPT_MAX_DIMENSION || height > RECEIPT_MAX_DIMENSION) {
          const scale = RECEIPT_MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", RECEIPT_JPEG_QUALITY);
        const sizeBytes = Math.round((dataUrl.length * 3) / 4);
        if (sizeBytes > RECEIPT_MAX_BYTES) {
          showToast("Receipt image is too large even after compression");
          resolve(null);
          return;
        }
        resolve({ dataUrl, type: "image/jpeg", width, height, sizeBytes, originalName: file.name });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function showReceiptPreview(receipt) {
  receiptPreviewImg.src = receipt.dataUrl;
  receiptPreview.hidden = false;
}

function clearPendingReceipt() {
  pendingReceipt = null;
  receiptPreviewImg.src = "";
  receiptPreview.hidden = true;
}

receiptInput.addEventListener("change", async () => {
  const file = receiptInput.files[0];
  receiptInput.value = "";
  if (!file) return;
  const processed = await processReceiptFile(file);
  if (!processed) return;
  pendingReceipt = processed;
  showReceiptPreview(processed);
});

receiptRemoveBtn.addEventListener("click", () => {
  clearPendingReceipt();
});

function openReceiptLightbox(receipt) {
  const backdrop = document.createElement("div");
  backdrop.className = "lightbox-backdrop";
  const img = document.createElement("img");
  img.src = receipt.dataUrl;
  img.alt = receipt.originalName || "Receipt";
  backdrop.append(img);

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  document.body.append(backdrop);
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL) {
    showToast("Please wait before adding another expense");
    return;
  }

  const amountCents = strToCents(amountInput.value);
  if (!isFinite(amountCents)) {
    showToast("Enter a valid amount");
    return;
  }
  if (!isValidDate(dateInput.value)) {
    showToast("Enter a valid date");
    return;
  }
  const note = noteInput.value.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    showToast(`Note limited to ${MAX_NOTE_LENGTH} characters`);
    return;
  }
  if (expenses.length >= MAX_EXPENSES) {
    showToast(`Maximum ${MAX_EXPENSES} expenses reached`);
    return;
  }

  lastSubmitTime = now;

  const expenseCategory = categoryInput.value;
  expenses.push({
    id: generateId(),
    amountCents,
    date: dateInput.value,
    category: expenseCategory,
    paymentMethod: paymentInput.value,
    note,
    receipt: pendingReceipt,
    createdAt: Date.now(),
  });

  const budgetCents = budgetsData.budgets[expenseCategory];
  if (budgetCents) {
    const monthKey = dateInput.value.slice(0, 7);
    const spentCents = expenses
      .filter((x) => x.category === expenseCategory && x.date.startsWith(monthKey))
      .reduce((s, x) => s + x.amountCents, 0);
    if (spentCents > budgetCents) {
      showToast(`Heads up: ${expenseCategory} is now ${formatAmount(spentCents)} of its ${formatAmount(budgetCents)} budget for ${monthKey}.`);
    }
  }

  amountInput.value = "";
  noteInput.value = "";
  clearPendingReceipt();
  update();
});

addCategoryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = categoryNameInput.value.trim();
  if (!name) return;
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    showToast(`Category name limited to ${MAX_CATEGORY_NAME_LENGTH} characters`);
    return;
  }
  if (name.toLowerCase() === "other" || budgetsData.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    showToast("That category already exists");
    return;
  }
  if (budgetsData.categories.length >= MAX_CATEGORIES) {
    showToast(`Maximum ${MAX_CATEGORIES} categories reached`);
    return;
  }
  budgetsData.categories.push({ name, colorSlot: nextColorSlot(budgetsData.categories) });
  categoryNameInput.value = "";
  updateBudgets();
});

categoryBudgetList.addEventListener("change", (e) => {
  if (!e.target.classList.contains("budget-input")) return;
  const row = e.target.closest(".category-budget-row");
  const catName = row.dataset.category;
  const value = e.target.value.trim();
  if (!value) {
    delete budgetsData.budgets[catName];
    updateBudgets();
    return;
  }
  const cents = strToCents(value);
  if (!isFinite(cents)) {
    showToast("Enter a valid budget amount");
    e.target.value = budgetsData.budgets[catName] ? centsToStr(budgetsData.budgets[catName]) : "";
    return;
  }
  budgetsData.budgets[catName] = cents;
  updateBudgets();
});

function renameCategoryEverywhere(oldName, newName) {
  const cat = budgetsData.categories.find((c) => c.name === oldName);
  if (cat) cat.name = newName;
  if (budgetsData.budgets[oldName] !== undefined) {
    budgetsData.budgets[newName] = budgetsData.budgets[oldName];
    delete budgetsData.budgets[oldName];
  }
  for (const e of expenses) {
    if (e.category === oldName) e.category = newName;
  }
  for (const tpl of recurringData.templates) {
    if (tpl.category === oldName) tpl.category = newName;
  }
  if (categoryFilter === oldName) categoryFilter = newName;
}

function deleteCategoryEverywhere(name) {
  const affected = expenses.filter((e) => e.category === name).length;
  const recurringAffected = recurringData.templates.filter((t) => t.category === name).length;
  let msg = `Delete category "${name}"?`;
  if (affected || recurringAffected) {
    const parts = [];
    if (affected) parts.push(`${affected} expense${affected === 1 ? "" : "s"}`);
    if (recurringAffected) parts.push(`${recurringAffected} recurring template${recurringAffected === 1 ? "" : "s"}`);
    msg = `Delete "${name}"? ${parts.join(" and ")} will be reassigned to "Other".`;
  }
  if (!confirm(msg)) return;

  undoSnapshot = expenses.slice();
  undoBudgetsSnapshot = cloneData(budgetsData);
  undoRecurringSnapshot = cloneData(recurringData);

  for (const e of expenses) if (e.category === name) e.category = "Other";
  for (const t of recurringData.templates) if (t.category === name) t.category = "Other";
  budgetsData.categories = budgetsData.categories.filter((c) => c.name !== name);
  delete budgetsData.budgets[name];
  if (categoryFilter === name) categoryFilter = "all";

  persistAll();
  showToast(`Category "${name}" deleted.`);
}

categoryBudgetList.addEventListener("click", (e) => {
  const renameBtn = e.target.closest(".cat-rename");
  if (renameBtn) {
    const row = renameBtn.closest(".category-budget-row");
    if (row.querySelector(".cat-name-edit")) return;
    const oldName = row.dataset.category;
    const nameSpan = row.querySelector(".cat-name");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cat-name-edit";
    input.value = oldName;
    input.maxLength = MAX_CATEGORY_NAME_LENGTH;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const newName = input.value.trim();
        if (!newName) {
          render();
          return;
        }
        if (newName.length > MAX_CATEGORY_NAME_LENGTH) {
          showToast(`Category name limited to ${MAX_CATEGORY_NAME_LENGTH} characters`);
          render();
          return;
        }
        const dup = budgetsData.categories.some(
          (c) => c.name !== oldName && c.name.toLowerCase() === newName.toLowerCase()
        );
        if (newName.toLowerCase() === "other" || dup) {
          showToast("That category name is already in use");
          render();
          return;
        }
        if (newName !== oldName) {
          renameCategoryEverywhere(oldName, newName);
          persistAll();
          return;
        }
      }
      render();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    row.addEventListener("focusout", (ev) => {
      if (!row.contains(ev.relatedTarget)) finish(true);
    });
    return;
  }

  const deleteBtn = e.target.closest(".cat-delete");
  if (deleteBtn) {
    const row = deleteBtn.closest(".category-budget-row");
    deleteCategoryEverywhere(row.dataset.category);
    return;
  }
});

recurringList.addEventListener("click", (e) => {
  const row = e.target.closest(".recurring-row");
  if (!row) return;
  const id = Number(row.dataset.id);
  const tpl = recurringData.templates.find((t) => t.id === id);
  if (!tpl) return;

  if (e.target.closest(".recurring-pause")) {
    tpl.active = !tpl.active;
    saveRecurring(recurringData);
    render();
    return;
  }

  if (e.target.closest(".recurring-delete")) {
    if (!confirm(`Delete this recurring expense (${formatAmount(tpl.amountCents)} · ${tpl.category})? Expenses already generated from it will stay in your list.`)) return;
    recurringData.templates = recurringData.templates.filter((t) => t.id !== id);
    saveRecurring(recurringData);
    render();
    return;
  }
});

function generateDueRecurringExpenses() {
  const nowMonth = currentYearMonth();
  let changed = false;
  for (const tpl of recurringData.templates) {
    if (!tpl.active) continue;
    let cursor = tpl.lastGeneratedMonth ? shiftYearMonth(tpl.lastGeneratedMonth, 1) : tpl.startDate.slice(0, 7);
    let guard = 0;
    while (compareYearMonth(cursor, nowMonth) <= 0 && guard < RECURRING_CATCHUP_MONTHS_CAP) {
      const day = clampDayForMonth(cursor, tpl.dayOfMonth);
      const date = `${cursor}-${pad(day)}`;
      expenses.push({
        id: generateId(),
        amountCents: tpl.amountCents,
        date,
        category: tpl.category,
        paymentMethod: tpl.paymentMethod,
        note: tpl.note,
        receipt: null,
        createdAt: Date.now(),
        recurringId: tpl.id,
      });
      tpl.lastGeneratedMonth = cursor;
      changed = true;
      cursor = shiftYearMonth(cursor, 1);
      guard++;
    }
  }
  if (changed) {
    saveExpenses(expenses);
    saveRecurring(recurringData);
  }
  return changed;
}

addRecurringForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const amountCents = strToCents(recurringAmountInput.value);
  if (!isFinite(amountCents)) {
    showToast("Enter a valid amount");
    return;
  }
  const day = Number(recurringDayInput.value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    showToast("Day of month must be between 1 and 31");
    return;
  }
  if (recurringData.templates.length >= MAX_RECURRING_TEMPLATES) {
    showToast(`Maximum ${MAX_RECURRING_TEMPLATES} recurring expenses reached`);
    return;
  }
  const note = recurringNoteInput.value.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    showToast(`Note limited to ${MAX_NOTE_LENGTH} characters`);
    return;
  }

  recurringData.templates.push({
    id: generateId(),
    amountCents,
    category: recurringCategoryInput.value,
    paymentMethod: recurringPaymentInput.value,
    note,
    frequency: "monthly",
    dayOfMonth: day,
    startDate: todayStr(),
    active: true,
    lastGeneratedMonth: null,
  });

  recurringAmountInput.value = "";
  recurringDayInput.value = "";
  recurringNoteInput.value = "";

  saveRecurring(recurringData);
  generateDueRecurringExpenses();
  render();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  renderList();
});

function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    expenses,
    budgetsData: { categories: budgetsData.categories, budgets: budgetsData.budgets, currency: budgetsData.currency },
    recurringData: { templates: recurringData.templates },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

backupBtn.addEventListener("click", exportBackup);
restoreBtn.addEventListener("click", () => restoreFileInput.click());

restoreFileInput.addEventListener("change", async () => {
  const file = restoreFileInput.files[0];
  restoreFileInput.value = "";
  if (!file) return;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.expenses) || !parsed.budgetsData) {
    showToast("That file is not a valid backup");
    return;
  }

  const newBudgets = sanitizeBudgetsData(parsed.budgetsData);
  const newCategoryNames = allCategoryNames(newBudgets.categories);
  const newExpenses = sanitizeExpensesList(parsed.expenses, newCategoryNames);
  const newRecurring = {
    version: 1,
    templates: sanitizeRecurringList(parsed.recurringData && parsed.recurringData.templates, newCategoryNames),
  };

  if (!confirm(`Replace your ${expenses.length} current expense(s) and all category/budget/recurring settings with ${newExpenses.length} imported expense(s)?`)) {
    return;
  }

  undoSnapshot = expenses.slice();
  undoBudgetsSnapshot = cloneData(budgetsData);
  undoRecurringSnapshot = cloneData(recurringData);

  expenses = newExpenses;
  budgetsData = newBudgets;
  recurringData = newRecurring;
  persistAll();
  showToast(`Imported ${newExpenses.length} expense(s).`);
});

currencyInput.addEventListener("change", () => {
  const val = currencyInput.value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(val)) {
    showToast("Currency code must be 3 letters, e.g. USD");
    currencyInput.value = budgetsData.currency;
    return;
  }
  budgetsData.currency = val;
  updateBudgets();
});

list.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li || !li.dataset.id) return;
  const id = Number(li.dataset.id);

  if (e.target.closest(".delete")) {
    undoSnapshot = expenses.slice();
    undoBudgetsSnapshot = null;
    undoRecurringSnapshot = null;
    expenses = expenses.filter((x) => x.id !== id);
    update();
    showToast("Expense deleted.");
    return;
  }

  if (e.target.closest(".receipt-btn")) {
    const exp = expenses.find((x) => x.id === id);
    if (exp && exp.receipt) openReceiptLightbox(exp.receipt);
    return;
  }
});

list.addEventListener("click", (e) => {
  const pen = e.target.closest(".pen");
  if (!pen) return;
  const li = pen.closest("li");
  if (li.querySelector(".edit")) return;
  const id = Number(li.dataset.id);
  const exp = expenses.find((x) => x.id === id);
  if (!exp) return;

  let editReceipt = exp.receipt;
  let editReceiptChanged = false;

  const amountEdit = document.createElement("input");
  amountEdit.type = "number";
  amountEdit.step = "0.01";
  amountEdit.min = "0.01";
  amountEdit.className = "edit amount-edit";
  amountEdit.value = centsToStr(exp.amountCents);
  li.querySelector(".amount").replaceWith(amountEdit);

  const dateEdit = document.createElement("input");
  dateEdit.type = "date";
  dateEdit.className = "edit date-edit";
  dateEdit.value = exp.date;
  li.querySelector(".date").replaceWith(dateEdit);

  const categoryEdit = document.createElement("select");
  categoryEdit.className = "category-edit";
  for (const name of allCategoryNames(budgetsData.categories)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    categoryEdit.append(opt);
  }
  categoryEdit.value = exp.category;
  li.querySelector(".category").replaceWith(categoryEdit);

  const paymentEdit = document.createElement("select");
  paymentEdit.className = "payment-edit";
  for (const m of PAYMENT_METHODS) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    paymentEdit.append(opt);
  }
  paymentEdit.value = exp.paymentMethod;
  li.querySelector(".payment").replaceWith(paymentEdit);

  const receiptOldBtn = li.querySelector(".receipt-btn");
  if (receiptOldBtn) receiptOldBtn.remove();
  const recurringBadgeOld = li.querySelector(".recurring-badge");
  if (recurringBadgeOld) recurringBadgeOld.remove();

  const noteEdit = document.createElement("textarea");
  noteEdit.className = "note-edit";
  noteEdit.rows = 2;
  noteEdit.placeholder = "Note (optional)";
  noteEdit.value = exp.note || "";
  const oldNote = li.querySelector(".note");
  if (oldNote) oldNote.replaceWith(noteEdit);
  else li.append(noteEdit);

  const receiptField = document.createElement("div");
  receiptField.className = "receipt-edit-field";
  const receiptFileInput = document.createElement("input");
  receiptFileInput.type = "file";
  receiptFileInput.accept = "image/*";
  receiptFileInput.title = "Replace receipt";
  const receiptStatus = document.createElement("span");
  receiptStatus.textContent = editReceipt ? "Receipt attached" : "No receipt";
  const receiptClearBtn = document.createElement("button");
  receiptClearBtn.type = "button";
  receiptClearBtn.textContent = "Remove";
  receiptClearBtn.hidden = !editReceipt;
  receiptField.append(receiptFileInput, receiptStatus, receiptClearBtn);
  li.append(receiptField);

  receiptFileInput.addEventListener("change", async () => {
    const file = receiptFileInput.files[0];
    receiptFileInput.value = "";
    if (!file) return;
    receiptStatus.textContent = "Processing…";
    const processed = await processReceiptFile(file);
    if (!processed) {
      receiptStatus.textContent = editReceipt ? "Receipt attached" : "No receipt";
      return;
    }
    editReceipt = processed;
    editReceiptChanged = true;
    receiptStatus.textContent = "New receipt attached";
    receiptClearBtn.hidden = false;
  });

  receiptClearBtn.addEventListener("click", () => {
    editReceipt = null;
    editReceiptChanged = true;
    receiptStatus.textContent = "No receipt";
    receiptClearBtn.hidden = true;
  });

  amountEdit.focus();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) {
      const amountCents = strToCents(amountEdit.value);
      if (!isFinite(amountCents)) {
        showToast("Enter a valid amount");
        update();
        return;
      }
      if (!isValidDate(dateEdit.value)) {
        showToast("Enter a valid date");
        update();
        return;
      }
      const noteValue = noteEdit.value.trim();
      if (noteValue.length > MAX_NOTE_LENGTH) {
        showToast(`Note limited to ${MAX_NOTE_LENGTH} characters`);
        update();
        return;
      }
      exp.amountCents = amountCents;
      exp.date = dateEdit.value;
      exp.category = categoryEdit.value;
      exp.paymentMethod = paymentEdit.value;
      exp.note = noteValue;
      if (editReceiptChanged) exp.receipt = editReceipt;
    }
    update();
  };

  for (const field of [amountEdit, dateEdit]) {
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
  }
  for (const field of [categoryEdit, paymentEdit]) {
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") finish(false);
    });
  }
  noteEdit.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) finish(true);
    else if (ev.key === "Escape") finish(false);
  });
  li.addEventListener("focusout", (ev) => {
    if (!li.contains(ev.relatedTarget)) finish(true);
  });
});

dateFromInput.addEventListener("change", () => {
  dateFrom = dateFromInput.value;
  renderList();
});
dateToInput.addEventListener("change", () => {
  dateTo = dateToInput.value;
  renderList();
});
categoryFilterSelect.addEventListener("change", () => {
  categoryFilter = categoryFilterSelect.value;
  renderList();
});
sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  renderList();
});

monthPrev.addEventListener("click", () => {
  dashboardMonth = shiftYearMonth(dashboardMonth, -1);
  renderDashboard();
});
monthNext.addEventListener("click", () => {
  dashboardMonth = shiftYearMonth(dashboardMonth, 1);
  renderDashboard();
});

chartViewToggle.addEventListener("click", () => {
  chartView = chartView === "chart" ? "table" : "chart";
  chartViewToggle.textContent = chartView === "chart" ? "View as table" : "View as chart";
  categoryChartContainer.hidden = chartView !== "chart";
  categoryTableContainer.hidden = chartView !== "table";
});

function exportCSV() {
  const rows = visibleExpenses();
  const header = ["Date", "Category", "Payment Method", "Amount", "Note", "Has Receipt"];
  const lines = [header.map(csvEscape).join(",")];
  for (const e of rows) {
    lines.push(
      [e.date, e.category, e.paymentMethod, centsToStr(e.amountCents), e.note, e.receipt ? "Yes" : "No"]
        .map(csvEscape)
        .join(",")
    );
  }
  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const scope = dateFrom || dateTo ? `${dateFrom || "start"}_${dateTo || todayStr()}` : "all";
  a.download = `expenses-${scope}-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

exportBtn.addEventListener("click", exportCSV);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#16171a" : "#f4f4f6";
}

function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY_THEME);
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(KEY_THEME, next);
  } catch {}
});

populatePaymentSelect();
currencyInput.value = budgetsData.currency;
dateInput.value = todayStr();
applyTheme(initialTheme());
if (generateDueRecurringExpenses()) {
  showToast("Generated upcoming recurring expense(s).");
}
render();
