const STATEMENT_PDF_MAX_BYTES = 15 * 1024 * 1024;

const TRANSACTION_TYPE_PHRASES = [
  "FAST Payment / Receipt",
  "Debit Card Transaction",
  "Funds Transfer",
  "Payments / Collections via GIRO",
  "Interest Earned",
];

const IGNORE_LINE_PATTERNS = [
  /^Balance Brought Forward$/i,
  /^Balance Carried Forward$/i,
  /^Total$/i,
  /^DBS Bank Ltd$/i,
  /^\d+ Marina Boulevard/i,
  /^www\.dbs\.com$/i,
  /^Page \d+ of \d+$/i,
  /^Details of Your/i,
  /^Account No\.:/i,
  /^DATE$/i,
  /^DETAILS OF TRANSACTIONS$/i,
  /^WITHDRAWAL/i,
  /^DEPOSIT/i,
  /^BALANCE/i,
  /^PDS_/i,
  /^As at /i,
];

const STOP_SECTION_PATTERN = /^Message For You$/i;

const DATE_LINE_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
const MONEY_RE = /^[\d,]+\.\d{2}$/;
const MONTH_MAP = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const CATEGORY_KEYWORD_RULES = [
  { category: "Transport", re: /BUS\/MRT|\bMRT\b|\bGRAB\b|TAXI|COMFORTDEL/i },
  { category: "Dining", re: /MCDONALD|STARBUCKS|WINGSTOP|GUZMAN|HEYTEA|KOPITIAM|RESTAURANT|\bCAFE\b|NOODLE|CHICKEN|DIM SUM|\bFOOD\b|KIOSK|BAD HABITS|GRILL|EXPRESS/i },
  { category: "Groceries", re: /NTUC|FAIRPRICE|COLD STORAGE|SHENG SIONG|\bGIANT\b|MARKETPLACE/i },
  { category: "Health", re: /GUARDIAN|WATSONS|PHARMACY|CLINIC|HOSPITAL|NUHS|POLYCLINIC/i },
  { category: "Entertainment", re: /SPOTIFY|NETFLIX|DISNEY|STEAM|CINEMA|GOLDEN VILLAGE|\bGV\b|SHAW THEATRE/i },
  { category: "Shopping", re: /SHOPEE|LAZADA|AMAZON|TAKASHIMAYA|UNIQLO|\bZARA\b/i },
  { category: "Utilities", re: /SP SERVICES|SP GROUP|SINGTEL|STARHUB|\bM1\b|UTILIT/i },
];

const SELF_TRANSFER_RE = /TOP-UP TO PAYLAH|PAYLAH!|\bI-BANK\b|FUNDS TRANSFER|INTERNET BANKING/i;

let pendingStatementRows = [];
let statementRowSeq = 0;

const importPanel = document.getElementById("import-panel");
const statementFileInput = document.getElementById("statement-file-input");
const statementStatus = document.getElementById("statement-status");
const statementReviewContainer = document.getElementById("statement-review-container");
const statementReviewActions = document.getElementById("statement-review-actions");
const statementSelectAllBtn = document.getElementById("statement-select-all-btn");
const statementSelectNoneBtn = document.getElementById("statement-select-none-btn");
const statementImportBtn = document.getElementById("statement-import-btn");

function statementImportAvailable() {
  return location.protocol !== "file:";
}

function groupIntoLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  const TOL = 2;
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= TOL);
    if (!line) {
      line = { y: it.y, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function detectColumns(lines) {
  for (const line of lines) {
    const dateHeader = line.items.find((it) => /^DATE$/i.test(it.str.trim()));
    const detailsHeader = line.items.find((it) => /DETAILS OF TRANSACTIONS/i.test(it.str));
    const withdrawalHeader = line.items.find((it) => /WITHDRAWAL/i.test(it.str));
    const depositHeader = line.items.find((it) => /DEPOSIT/i.test(it.str));
    const balanceHeader = line.items.find((it) => /BALANCE/i.test(it.str));
    if (dateHeader && detailsHeader && withdrawalHeader && depositHeader) {
      return {
        dateX: dateHeader.x,
        detailsX: detailsHeader.x,
        withdrawalX: withdrawalHeader.x,
        depositX: depositHeader.x,
        balanceX: balanceHeader ? balanceHeader.x : withdrawalHeader.x + 9999,
      };
    }
  }
  return null;
}

// Date/details are left-aligned (classify by left edge vs. header-midpoints);
// withdrawal/deposit/balance are narrow, right-aligned numeric columns, so a short
// value's left edge can land far to the right of its own column's header text.
// Those are classified by RIGHT edge against the *next* column's raw start position,
// since a right-aligned value's right edge sits just before where the next column begins.
function classifyColumn(item, columns) {
  const midDetailsWithdrawal = (columns.detailsX + columns.withdrawalX) / 2;
  if (item.x < midDetailsWithdrawal) {
    const midDateDetails = (columns.dateX + columns.detailsX) / 2;
    return item.x >= midDateDetails ? "details" : "date";
  }
  const rightEdge = item.x + (item.width || 0);
  if (rightEdge <= columns.depositX) return "withdrawal";
  if (rightEdge <= columns.balanceX) return "deposit";
  return "balance";
}

function extractTransactions(lines, columns) {
  const transactions = [];
  let current = null;
  let currentDate = null;
  let stopped = false;

  const flush = () => {
    if (current && (current.withdrawal != null || current.deposit != null)) {
      transactions.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (stopped) break;
    const cols = { date: [], details: [], withdrawal: [], deposit: [], balance: [] };
    for (const it of line.items) {
      cols[classifyColumn(it, columns)].push(it.str);
    }
    const dateText = cols.date.join(" ").trim();
    const detailsText = cols.details.join(" ").trim();
    const withdrawalText = cols.withdrawal.join(" ").trim();
    const depositText = cols.deposit.join(" ").trim();

    if (!dateText && !detailsText && !withdrawalText && !depositText) continue;
    if (STOP_SECTION_PATTERN.test(detailsText)) {
      stopped = true;
      break;
    }
    if (IGNORE_LINE_PATTERNS.some((re) => re.test(detailsText))) continue;

    if (dateText && DATE_LINE_RE.test(dateText)) {
      flush();
      currentDate = dateText;
      current = { date: currentDate, hasType: false, descLines: [], withdrawal: null, deposit: null };
    }

    if (detailsText) {
      const isTypePhrase = TRANSACTION_TYPE_PHRASES.some((p) => detailsText.toUpperCase() === p.toUpperCase());
      if (isTypePhrase && current && current.hasType) {
        flush();
        current = { date: currentDate, hasType: false, descLines: [], withdrawal: null, deposit: null };
      }
      if (isTypePhrase && current) {
        current.hasType = true;
      }
      if (current) {
        current.descLines.push(detailsText);
      }
    }

    if (withdrawalText && MONEY_RE.test(withdrawalText) && current) {
      current.withdrawal = withdrawalText;
    }
    if (depositText && MONEY_RE.test(depositText) && current) {
      current.deposit = depositText;
    }
  }
  flush();
  return transactions;
}

function assignYears(transactions, endYear) {
  const reversed = [...transactions].reverse();
  let year = endYear;
  let prevMonth = null;
  const out = [];
  for (const t of reversed) {
    const dm = DATE_LINE_RE.exec(t.date.trim());
    if (!dm) continue;
    const day = Number(dm[1]);
    const month = MONTH_MAP[dm[2].slice(0, 3).toLowerCase()];
    if (prevMonth !== null && month > prevMonth) year--;
    prevMonth = month;
    out.push({ ...t, isoDate: `${year}-${pad(month)}-${pad(day)}` });
  }
  return out.reverse();
}

function guessCategory(descriptionText, categoryNames) {
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (rule.re.test(descriptionText) && categoryNames.includes(rule.category)) return rule.category;
  }
  return "Other";
}

function guessPaymentMethod(descriptionText) {
  if (/Debit Card Transaction/i.test(descriptionText)) return "Debit Card";
  if (/FAST Payment|Funds Transfer|PayNow|GIRO|I-BANK/i.test(descriptionText)) return "Bank Transfer";
  return "Other";
}

async function extractPdfPages(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((it) => it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width || 0 }))
    );
  }
  return pages;
}

function buildReviewRows(transactionsWithYears) {
  const categoryNames = allCategoryNames(budgetsData.categories);
  return transactionsWithYears.map((t) => {
    const description = t.descLines.join(" · ");
    const direction = t.withdrawal != null ? "withdrawal" : "deposit";
    const amountCents = strToCentsLoose(direction === "withdrawal" ? t.withdrawal : t.deposit);
    const isSelfTransfer = SELF_TRANSFER_RE.test(description);
    return {
      rowId: statementRowSeq++,
      date: t.isoDate,
      description,
      direction,
      amountCents,
      category: direction === "withdrawal" ? guessCategory(description, categoryNames) : "Other",
      paymentMethod: guessPaymentMethod(description),
      isSelfTransfer,
      checked: direction === "withdrawal" && !isSelfTransfer,
    };
  }).filter((r) => isFinite(r.amountCents) && r.amountCents > 0);
}

function strToCentsLoose(str) {
  if (!str) return NaN;
  const n = Number(str.replace(/,/g, ""));
  return isFinite(n) ? Math.round(n * 100) : NaN;
}

function renderStatementReview() {
  statementReviewContainer.textContent = "";
  if (!pendingStatementRows.length) {
    statementReviewActions.hidden = true;
    return;
  }
  statementReviewActions.hidden = false;

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["", "Date", "Description", "Category", "Payment", "Amount"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  const categoryNames = allCategoryNames(budgetsData.categories);

  for (const row of pendingStatementRows) {
    const tr = document.createElement("tr");
    if (row.isSelfTransfer) tr.className = "self-transfer";
    tr.dataset.rowId = row.rowId;

    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = row.checked;
    checkbox.className = "statement-row-check";
    checkCell.append(checkbox);
    tr.append(checkCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = row.date;
    tr.append(dateCell);

    const descCell = document.createElement("td");
    descCell.className = "desc-cell";
    descCell.title = row.description;
    descCell.textContent = row.description;
    tr.append(descCell);

    const catCell = document.createElement("td");
    const catSelect = document.createElement("select");
    catSelect.className = "statement-row-category";
    for (const name of categoryNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      catSelect.append(opt);
    }
    catSelect.value = row.category;
    catCell.append(catSelect);
    tr.append(catCell);

    const payCell = document.createElement("td");
    const paySelect = document.createElement("select");
    paySelect.className = "statement-row-payment";
    for (const m of PAYMENT_METHODS) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      paySelect.append(opt);
    }
    paySelect.value = row.paymentMethod;
    payCell.append(paySelect);
    tr.append(payCell);

    const amountCell = document.createElement("td");
    amountCell.className = "num" + (row.direction === "deposit" ? " deposit-amount" : "");
    amountCell.textContent = (row.direction === "deposit" ? "+" : "") + formatAmount(row.amountCents);
    tr.append(amountCell);

    tbody.append(tr);
  }
  table.append(tbody);
  statementReviewContainer.append(table);
}

statementReviewContainer.addEventListener("change", (e) => {
  const tr = e.target.closest("tr[data-row-id]");
  if (!tr) return;
  const row = pendingStatementRows.find((r) => r.rowId === Number(tr.dataset.rowId));
  if (!row) return;
  if (e.target.classList.contains("statement-row-check")) row.checked = e.target.checked;
  else if (e.target.classList.contains("statement-row-category")) row.category = e.target.value;
  else if (e.target.classList.contains("statement-row-payment")) row.paymentMethod = e.target.value;
});

statementSelectAllBtn.addEventListener("click", () => {
  for (const row of pendingStatementRows) row.checked = true;
  renderStatementReview();
});
statementSelectNoneBtn.addEventListener("click", () => {
  for (const row of pendingStatementRows) row.checked = false;
  renderStatementReview();
});

statementImportBtn.addEventListener("click", () => {
  const checkedRows = pendingStatementRows.filter((r) => r.checked);
  if (!checkedRows.length) {
    showToast("No rows selected to import");
    return;
  }
  if (expenses.length + checkedRows.length > MAX_EXPENSES) {
    showToast(`Importing would exceed the ${MAX_EXPENSES} expense limit`);
    return;
  }

  undoSnapshot = expenses.slice();
  undoBudgetsSnapshot = null;
  undoRecurringSnapshot = null;

  for (const row of checkedRows) {
    expenses.push({
      id: generateId(),
      amountCents: row.amountCents,
      date: row.date,
      category: row.category,
      paymentMethod: row.paymentMethod,
      note: row.description.slice(0, MAX_NOTE_LENGTH),
      receipt: null,
      createdAt: Date.now(),
    });
  }

  update();
  showToast(`Imported ${checkedRows.length} expense(s) from statement.`);

  pendingStatementRows = [];
  statementReviewContainer.textContent = "";
  statementReviewActions.hidden = true;
  statementStatus.textContent = "";
});

statementFileInput.addEventListener("change", async () => {
  const file = statementFileInput.files[0];
  statementFileInput.value = "";
  if (!file) return;

  pendingStatementRows = [];
  statementReviewContainer.textContent = "";
  statementReviewActions.hidden = true;

  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    statementStatus.textContent = "Please choose a PDF file.";
    return;
  }
  if (file.size > STATEMENT_PDF_MAX_BYTES) {
    statementStatus.textContent = "That PDF is too large.";
    return;
  }

  statementStatus.textContent = "Parsing statement…";
  try {
    const pages = await extractPdfPages(file);
    const allText = pages.flat().map((it) => it.str).join(" ");
    const asAtMatch = /As at (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})/i.exec(allText);
    const endYear = asAtMatch ? Number(asAtMatch[3]) : new Date().getFullYear();

    let columns = null;
    let allLines = [];
    for (const pageItems of pages) {
      const lines = groupIntoLines(pageItems);
      if (!columns) columns = detectColumns(lines);
      allLines = allLines.concat(lines);
    }

    if (!columns) {
      statementStatus.textContent =
        "Could not detect a transaction table in this PDF. This importer is tuned for DBS-style statements; other bank layouts may not be recognized yet.";
      return;
    }

    const transactions = extractTransactions(allLines, columns);
    const withYears = assignYears(transactions, endYear);
    pendingStatementRows = buildReviewRows(withYears);

    if (!pendingStatementRows.length) {
      statementStatus.textContent = "No transactions were found in this PDF.";
      return;
    }

    renderStatementReview();
    statementStatus.textContent = `Found ${pendingStatementRows.length} transaction(s). Review and select which to import (deposits and likely self-transfers start unchecked).`;
  } catch (e) {
    statementStatus.textContent = "Could not read this PDF: " + e.message;
  }
});

function initStatementImport() {
  if (statementImportAvailable()) return;
  statementFileInput.disabled = true;
  statementStatus.textContent =
    "PDF import needs the app served over http/https (browser security blocks background PDF workers when opened as a local file). It works on your deployed site.";
}

initStatementImport();
