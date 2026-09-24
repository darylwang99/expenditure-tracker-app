const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    el.setAttribute(k, v);
  }
  return el;
}

function categoryColorVar(colorSlot) {
  return Number.isInteger(colorSlot) ? `var(--series-${colorSlot + 1})` : "var(--series-other)";
}

// rows: [{ label, colorSlot, amountCents, percent }] sorted descending, "Other" bucket already merged in
function renderCategoryBarChart(rows, formatAmount) {
  const rowHeight = 26;
  const gap = 10;
  const width = 600;
  const height = rows.length ? rows.length * (rowHeight + gap) - gap : rowHeight;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${Math.max(height, rowHeight)}`,
    class: "category-chart",
    role: "img",
    "aria-label": "Spending by category",
  });
  if (!rows.length) return svg;

  const maxAmount = Math.max(...rows.map((r) => r.amountCents), 1);
  const labelWidth = 150;
  const amountWidth = 90;
  const barAreaWidth = width - labelWidth - amountWidth;

  rows.forEach((row, i) => {
    const y = i * (rowHeight + gap);
    const barWidth = Math.max((row.amountCents / maxAmount) * barAreaWidth, 2);
    const g = svgEl("g", { transform: `translate(0, ${y})` });

    const swatch = svgEl("rect", { x: 0, y: 6, width: 12, height: 12, rx: 3, fill: categoryColorVar(row.colorSlot) });
    g.append(swatch);

    const label = svgEl("text", { x: 18, y: 15, class: "chart-label" });
    label.textContent = `${row.label} (${row.percent}%)`;
    g.append(label);

    const track = svgEl("rect", { x: labelWidth, y: 2, width: barAreaWidth, height: rowHeight - 4, rx: 4, class: "chart-track" });
    g.append(track);

    const bar = svgEl("rect", { x: labelWidth, y: 2, width: barWidth, height: rowHeight - 4, rx: 4, fill: categoryColorVar(row.colorSlot) });
    g.append(bar);

    const amountText = svgEl("text", { x: width, y: 15, class: "chart-amount", "text-anchor": "end" });
    amountText.textContent = formatAmount(row.amountCents);
    g.append(amountText);

    svg.append(g);
  });

  return svg;
}

// rows: [{ yearMonth, label, totalCents, isCurrent }] oldest first
function renderTrendChart(rows, formatAmount) {
  const width = 600;
  const chartHeight = 130;
  const labelHeight = 30;
  const height = chartHeight + labelHeight;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    class: "trend-chart",
    role: "img",
    "aria-label": "Monthly spending trend",
  });
  if (!rows.length) return svg;

  const maxAmount = Math.max(...rows.map((r) => r.totalCents), 1);
  const gap = 12;
  const barWidth = (width - gap * (rows.length - 1)) / rows.length;

  rows.forEach((row, i) => {
    const x = i * (barWidth + gap);
    const barHeight = row.totalCents > 0 ? Math.max((row.totalCents / maxAmount) * (chartHeight - 24), 3) : 0;
    const y = chartHeight - barHeight;
    const g = svgEl("g", {});

    const title = svgEl("title", {});
    title.textContent = `${row.label}: ${formatAmount(row.totalCents)}`;
    g.append(title);

    if (row.totalCents > 0) {
      const amountText = svgEl("text", { x: x + barWidth / 2, y: Math.max(y - 6, 10), class: "trend-amount", "text-anchor": "middle" });
      amountText.textContent = formatAmount(row.totalCents);
      g.append(amountText);
    }

    const bar = svgEl("rect", {
      x, y, width: barWidth, height: barHeight, rx: 4,
      class: "trend-bar" + (row.isCurrent ? " current" : ""),
    });
    g.append(bar);

    const label = svgEl("text", { x: x + barWidth / 2, y: chartHeight + 18, class: "trend-label", "text-anchor": "middle" });
    label.textContent = row.label;
    g.append(label);

    svg.append(g);
  });

  return svg;
}

// rows: [{ label, colorSlot, budgetCents, actualCents }]
function renderBudgetMeters(rows, formatAmount) {
  const rowHeight = 48;
  const width = 600;
  const height = rows.length * rowHeight;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${Math.max(height, rowHeight)}`,
    class: "budget-chart",
    role: "img",
    "aria-label": "Budget versus actual spending by category",
  });
  if (!rows.length) return svg;

  rows.forEach((row, i) => {
    const y = i * rowHeight;
    const ratio = row.budgetCents > 0 ? row.actualCents / row.budgetCents : 0;
    const clamped = Math.min(ratio, 1);
    const trackWidth = width - 20;
    const g = svgEl("g", { transform: `translate(10, ${y})` });

    const label = svgEl("text", { x: 0, y: 14, class: "chart-label" });
    label.textContent = row.label;
    g.append(label);

    const amountText = svgEl("text", { x: trackWidth, y: 14, class: "chart-amount", "text-anchor": "end" });
    amountText.textContent = `${formatAmount(row.actualCents)} / ${formatAmount(row.budgetCents)}`;
    g.append(amountText);

    const track = svgEl("rect", { x: 0, y: 20, width: trackWidth, height: 14, rx: 7, class: "meter-track" });
    g.append(track);

    let fillClass = "meter-fill";
    if (ratio > 1) fillClass += " over";
    else if (ratio >= 0.8) fillClass += " warning";

    const fillWidth = ratio > 0 ? Math.max(clamped * trackWidth, 3) : 0;
    const fill = svgEl("rect", { x: 0, y: 20, width: fillWidth, height: 14, rx: 7, class: fillClass });
    if (ratio <= 0.8) fill.setAttribute("fill", categoryColorVar(row.colorSlot));
    g.append(fill);

    if (ratio > 1) {
      const overText = svgEl("text", { x: 0, y: 44, class: "chart-over" });
      overText.textContent = `${ratio.toFixed(1)}x over budget`;
      g.append(overText);
    }

    svg.append(g);
  });

  return svg;
}
