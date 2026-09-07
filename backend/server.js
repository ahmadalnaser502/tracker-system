/**
 * Personal Development & Life Tracking System — Backend
 * ---------------------------------------------------------------
 * Express API, run directly via PM2 (no IIS/iisnode — see SETUP.md
 * for why that approach was abandoned in favor of PM2).
 *
 * All data lives as JSON files on disk under DATA_DIR, configured
 * via the TRACKER_DATA_DIR environment variable (see .env.example).
 * This directory is the single source of truth — no browser storage
 * is used anywhere in this system.
 *
 * Files:
 *   data.json     -> { entries: { "YYYY-MM-DD": {...} }, currentPlanId }
 *   plans/<id>.json -> one weekly plan each, uploaded as JSON
 *   reviews.json  -> { "weekStartDate": {...} }
 *
 * Every write is atomic (write to temp file, then rename) so a
 * crash or power loss mid-write can never corrupt years of data.
 */

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const app = express();
app.use(express.json({ limit: "5mb" }));

const client = require("prom-client");

// يجمع مقاييس افتراضية عن عملية Node.js نفسها (استخدام الذاكرة،
// الـ event loop lag، عدد الـ garbage collections، إلخ) — تلقائيًا
client.collectDefaultMetrics();

// Counter: إجمالي عدد طلبات HTTP، مصنّفة حسب الطريقة والمسار والحالة
const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

// Histogram: مدة كل طلب بالثواني
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

// Middleware: يسجّل كل طلب تلقائيًا، بدون تعديل أي route موجود
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestCounter.inc(labels);
    end(labels);
  });
  next();
});

// Endpoint الذي سيقرأه Prometheus
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});
// ---------------------------------------------------------------
// Data directory resolution
// ---------------------------------------------------------------
// Under PM2, TRACKER_DATA_DIR should always be set explicitly
// (e.g. "D:\tracker-system\Tracker"). Without it, we fall back to
// a local ./data folder — convenient for quick local testing, but
// NOT where you want your real years-long data to live.
const DATA_DIR =
  process.env.TRACKER_DATA_DIR || path.join(__dirname, "data");

if (!process.env.TRACKER_DATA_DIR) {
  console.warn(
    "[WARN] TRACKER_DATA_DIR is not set. Using local ./data folder.\n" +
    "       Set TRACKER_DATA_DIR to your real data path before relying on this."
  );
}

const PLANS_DIR = path.join(DATA_DIR, "plans");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
const FINANCE_FILE = path.join(DATA_DIR, "finance.json");

const {
  DAILY_EXPENSE_KEYS,
  MONTHLY_EXPENSE_KEYS,
  MONTHLY_INCOME_KEYS,
  emptyFinance,
  normalizeFinance,
  slugifyKey,
  allDailyKeys,
  allMonthlyKeys,
  dailyLabels,
  monthlyLabels,
  sumDailyEntry,
  netMonthlyEntry,
  diffHistory,
} = require("./helpers.js");

function ensureDirs() {
  for (const dir of [DATA_DIR, PLANS_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

async function readJSON(filePath, fallback) {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

// Atomic write: write to a temp file in the same directory, then
// rename over the target. Rename is atomic on the same volume, so
// the target file is never left half-written.
async function writeJSONAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fsp.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------
// Health / diagnostics
// ---------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    dataDir: DATA_DIR,
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------
// Daily entries — data.json  { entries: { date: entry } }
// ---------------------------------------------------------------
app.get("/api/data", async (req, res) => {
  try {
    const data = await readJSON(DATA_FILE, { entries: {} });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: String(err) });
  }
});

app.post("/api/entry", async (req, res) => {
  try {
    const { date, entry } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }
    const data = await readJSON(DATA_FILE, { entries: {} });
    data.entries[date] = { ...entry, savedAt: new Date().toISOString() };
    await writeJSONAtomic(DATA_FILE, data);
    res.json({ ok: true, date });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// ---------------------------------------------------------------
// Weekly plans — one JSON file per plan under /plans, indexed by
// weekStart date (YYYY-MM-DD, Saturday). Uploaded by the user,
// authored by Claude in a separate weekly-planning conversation.
// ---------------------------------------------------------------
app.get("/api/plans", async (req, res) => {
  try {
    ensureDirs();
    const files = (await fsp.readdir(PLANS_DIR)).filter((f) =>
      f.endsWith(".json")
    );
    const plans = [];
    for (const f of files) {
      const plan = await readJSON(path.join(PLANS_DIR, f), null);
      if (plan) plans.push(plan);
    }
    plans.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: String(err) });
  }
});

app.get("/api/plans/:weekStart", async (req, res) => {
  try {
    const plan = await readJSON(
      path.join(PLANS_DIR, `${req.params.weekStart}.json`),
      null
    );
    if (!plan) return res.status(404).json({ error: "not_found" });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: String(err) });
  }
});

app.post("/api/plans", async (req, res) => {
  try {
    const plan = req.body;
    if (!plan || !plan.weekStart || !Array.isArray(plan.topics)) {
      return res
        .status(400)
        .json({ error: "invalid_plan", detail: "weekStart and topics[] are required" });
    }
    await writeJSONAtomic(
      path.join(PLANS_DIR, `${plan.weekStart}.json`),
      plan
    );
    res.json({ ok: true, weekStart: plan.weekStart });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

app.delete("/api/plans/:weekStart", async (req, res) => {
  try {
    const filePath = path.join(PLANS_DIR, `${req.params.weekStart}.json`);
    if (fs.existsSync(filePath)) await fsp.unlink(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "delete_failed", detail: String(err) });
  }
});

// ---------------------------------------------------------------
// Weekly reviews — reviews.json { weekStart: {...} }
// ---------------------------------------------------------------
app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await readJSON(REVIEWS_FILE, {});
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: String(err) });
  }
});

app.post("/api/reviews", async (req, res) => {
  try {
    const { weekStart, review } = req.body;
    if (!weekStart) return res.status(400).json({ error: "invalid_week" });
    const reviews = await readJSON(REVIEWS_FILE, {});
    reviews[weekStart] = { ...review, savedAt: new Date().toISOString() };
    await writeJSONAtomic(REVIEWS_FILE, reviews);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// ---------------------------------------------------------------
// Finance — finance.json { bankBalance, dailyExpenses, monthlyExpenses }
//
// The bank balance is never edited directly by the client. It starts
// from a one-time manual initialization, then every daily/monthly
// save applies only the *delta* between the old and new stored value
// for that date/month, so editing an already-saved entry adjusts the
// balance correctly instead of double-counting.
// ---------------------------------------------------------------
app.get("/api/finance", async (req, res) => {
  try {
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    res.json(finance);
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: String(err) });
  }
});

// One-time initialization of the starting bank balance. Refuses to
// overwrite an existing balance unless { force: true } is sent.
app.post("/api/finance/bank-init", async (req, res) => {
  try {
    const { amount, force } = req.body;
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      return res.status(400).json({ error: "invalid_amount" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    if (finance.bankBalance !== null && !force) {
      return res.status(409).json({
        error: "already_initialized",
        detail: "الرصيد الابتدائي معيّن مسبقًا. أرسل force=true لإعادة التعيين.",
        currentBalance: finance.bankBalance,
      });
    }
    finance.bankBalance = amount;
    finance.bankInitializedAt = new Date().toISOString();
    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, bankBalance: finance.bankBalance, pocketBalance: finance.pocketBalance });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// Instant transfer between bank and pocket. direction is "toPocket"
// (bank -> pocket) or "toBank" (pocket -> bank). No date/reason kept —
// this is a simple balance move, not a logged transaction.
app.post("/api/finance/transfer", async (req, res) => {
  try {
    const { direction, amount } = req.body;
    if (direction !== "toPocket" && direction !== "toBank") {
      return res.status(400).json({ error: "invalid_direction" });
    }
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    if (finance.bankBalance === null) {
      return res.status(409).json({
        error: "bank_not_initialized",
        detail: "يجب تعيين الرصيد الابتدائي للبنك أولًا.",
      });
    }

    if (direction === "toPocket") {
      if (finance.bankBalance < amount) {
        return res.status(409).json({
          error: "bank_insufficient",
          detail: `رصيد البنك غير كافٍ لتحويل هذا المبلغ.`,
          bankBalance: finance.bankBalance,
        });
      }
      finance.bankBalance -= amount;
      finance.pocketBalance += amount;
    } else {
      if (finance.pocketBalance < amount) {
        return res.status(409).json({
          error: "pocket_insufficient",
          detail: `رصيد الجيب غير كافٍ لتحويل هذا المبلغ.`,
          pocketBalance: finance.pocketBalance,
        });
      }
      finance.pocketBalance -= amount;
      finance.bankBalance += amount;
    }

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({
      ok: true,
      direction,
      amount,
      bankBalance: finance.bankBalance,
      pocketBalance: finance.pocketBalance,
    });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// Add a custom expense/income category. scope is "daily" or "monthly".
// The key is generated server-side from the label; the client never
// invents or sends one.
app.post("/api/finance/categories", async (req, res) => {
  try {
    const { scope, label, income } = req.body;
    if (scope !== "daily" && scope !== "monthly") {
      return res.status(400).json({ error: "invalid_scope" });
    }
    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: "invalid_label" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));

    const existingKeys = new Set(
      (scope === "daily" ? allDailyKeys(finance) : allMonthlyKeys(finance))
    );
    const key = slugifyKey(label, existingKeys);

    const category = { key, label: String(label).trim() };
    if (scope === "monthly") category.income = Boolean(income);

    finance.customCategories[scope].push(category);
    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, category, customCategories: finance.customCategories });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// Remove a custom category from the active list. Historical values
// already saved under that key are left untouched in past entries —
// only future daily/monthly saves stop showing/accepting the field.
app.delete("/api/finance/categories/:scope/:key", async (req, res) => {
  try {
    const { scope, key } = req.params;
    if (scope !== "daily" && scope !== "monthly") {
      return res.status(400).json({ error: "invalid_scope" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    finance.customCategories[scope] = finance.customCategories[scope].filter(
      (c) => c.key !== key
    );
    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, customCategories: finance.customCategories });
  } catch (err) {
    res.status(500).json({ error: "delete_failed", detail: String(err) });
  }
});

app.post("/api/finance/daily", async (req, res) => {
  try {
    const { date, expenses } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    if (finance.bankBalance === null) {
      return res.status(409).json({
        error: "bank_not_initialized",
        detail: "يجب تعيين الرصيد الابتدائي للبنك أولًا.",
      });
    }

    const keys = allDailyKeys(finance);
    const oldEntry = finance.dailyExpenses[date] || {};
    // Use the union of currently-active keys and whatever keys already
    // exist in the stored entry, so a category deleted after this date
    // was saved still gets correctly un-counted from the old total
    // instead of silently vanishing from the balance calculation.
    const oldKeys = Array.from(new Set([...keys, ...Object.keys(oldEntry).filter((k) => k !== "savedAt")]));
    const oldTotal = sumDailyEntry(oldEntry, oldKeys);

    const newEntry = {};
    keys.forEach((k) => {
      newEntry[k] = Number(expenses?.[k]) || 0;
    });
    const newTotal = sumDailyEntry(newEntry, keys);

    // Expenses are always paid from pocket cash, never straight from the
    // bank. Only the delta (increase) needs to be covered — editing an
    // entry down (or unchanged) never requires more pocket cash.
    const delta = newTotal - oldTotal;
    if (delta > 0 && finance.pocketBalance < delta) {
      return res.status(409).json({
        error: "pocket_insufficient",
        detail: `رصيد الجيب غير كافٍ. تحتاج ${(delta - finance.pocketBalance).toFixed(2)} إضافية — حوّل من البنك للجيب أولًا.`,
        pocketBalance: finance.pocketBalance,
        shortfall: delta - finance.pocketBalance,
      });
    }

    const changes = diffHistory(oldEntry, newEntry, keys, dailyLabels(finance));
    const prevHistory = Array.isArray(oldEntry.history) ? oldEntry.history : [];

    finance.dailyExpenses[date] = {
      ...newEntry,
      savedAt: new Date().toISOString(),
      history: prevHistory.concat(changes),
    };
    finance.pocketBalance = finance.pocketBalance - delta;

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({
      ok: true,
      date,
      bankBalance: finance.bankBalance,
      pocketBalance: finance.pocketBalance,
      changes,
    });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

app.post("/api/finance/monthly", async (req, res) => {
  try {
    const { month, entry } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "invalid_month" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    if (finance.bankBalance === null) {
      return res.status(409).json({
        error: "bank_not_initialized",
        detail: "يجب تعيين الرصيد الابتدائي للبنك أولًا.",
      });
    }

    const keys = allMonthlyKeys(finance);
    const incomeKeys = new Set(MONTHLY_INCOME_KEYS);
    finance.customCategories.monthly.forEach((c) => {
      if (c.income) incomeKeys.add(c.key);
    });

    const oldEntry = finance.monthlyExpenses[month] || {};
    // Union with keys already present in the stored entry, so a category
    // deleted after this month was saved is still correctly un-counted
    // (as an expense — the safer assumption when its income/expense
    // flag is no longer known) instead of vanishing from the balance.
    const oldKeys = Array.from(new Set([...keys, ...Object.keys(oldEntry).filter((k) => k !== "savedAt")]));
    // Split old amounts into their expense portion (paid from pocket)
    // and income portion (credited to bank) so each can be delta-adjusted
    // against the correct balance below.
    const oldExpenseTotal = oldKeys
      .filter((k) => !incomeKeys.has(k))
      .reduce((s, k) => s + (Number(oldEntry[k]) || 0), 0);
    const oldIncomeTotal = oldKeys
      .filter((k) => incomeKeys.has(k))
      .reduce((s, k) => s + (Number(oldEntry[k]) || 0), 0);

    const newEntry = {};
    keys.forEach((k) => {
      newEntry[k] = Number(entry?.[k]) || 0;
    });
    const newExpenseTotal = keys
      .filter((k) => !incomeKeys.has(k))
      .reduce((s, k) => s + newEntry[k], 0);
    const newIncomeTotal = keys
      .filter((k) => incomeKeys.has(k))
      .reduce((s, k) => s + newEntry[k], 0);

    // Expense portion is paid from pocket cash; only the increase needs
    // to be covered by existing pocket funds.
    const expenseDelta = newExpenseTotal - oldExpenseTotal;
    if (expenseDelta > 0 && finance.pocketBalance < expenseDelta) {
      return res.status(409).json({
        error: "pocket_insufficient",
        detail: `رصيد الجيب غير كافٍ. تحتاج ${(expenseDelta - finance.pocketBalance).toFixed(2)} إضافية — حوّل من البنك للجيب أولًا.`,
        pocketBalance: finance.pocketBalance,
        shortfall: expenseDelta - finance.pocketBalance,
      });
    }

    const changes = diffHistory(oldEntry, newEntry, keys, monthlyLabels(finance));
    const prevHistory = Array.isArray(oldEntry.history) ? oldEntry.history : [];

    finance.monthlyExpenses[month] = {
      ...newEntry,
      savedAt: new Date().toISOString(),
      history: prevHistory.concat(changes),
    };
    finance.pocketBalance = finance.pocketBalance - expenseDelta;
    // Income portion (a custom monthly category flagged as income) is
    // credited straight to the bank, same as any other income.
    finance.bankBalance = finance.bankBalance + (newIncomeTotal - oldIncomeTotal);

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({
      ok: true,
      month,
      bankBalance: finance.bankBalance,
      pocketBalance: finance.pocketBalance,
      changes,
    });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// ---------------------------------------------------------------
// Extra income transactions — free-form entries with an amount, a
// reason, and any date, separate from the fixed monthly salary field.
// Each one adds directly to the bank balance when saved and subtracts
// it back out when deleted (or by the delta when its amount is edited).
// ---------------------------------------------------------------
app.post("/api/finance/income", async (req, res) => {
  try {
    const { date, amount, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    if (finance.bankBalance === null) {
      return res.status(409).json({
        error: "bank_not_initialized",
        detail: "يجب تعيين الرصيد الابتدائي للبنك أولًا.",
      });
    }

    const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const txn = {
      id,
      date,
      amount,
      reason: reason ? String(reason).trim() : "",
      savedAt: new Date().toISOString(),
    };
    finance.incomeTransactions[id] = txn;
    finance.bankBalance = finance.bankBalance + amount;

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, transaction: txn, bankBalance: finance.bankBalance, pocketBalance: finance.pocketBalance });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

// Edit an existing income transaction's amount/reason/date. Applies
// only the balance delta between the old and new amount.
app.put("/api/finance/income/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { date, amount, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    const existing = finance.incomeTransactions[id];
    if (!existing) return res.status(404).json({ error: "not_found" });

    const oldAmount = Number(existing.amount) || 0;
    const prevHistory = Array.isArray(existing.history) ? existing.history : [];
    const changes = [];
    const now = new Date().toISOString();
    if (oldAmount !== amount) {
      changes.push({ field: "amount", label: "المبلغ", old: oldAmount, new: amount, at: now });
    }
    if ((existing.date || "") !== date) {
      changes.push({ field: "date", label: "التاريخ", old: existing.date || "", new: date, at: now });
    }
    const oldReasonTrim = (existing.reason || "").trim();
    const newReasonTrim = reason ? String(reason).trim() : "";
    if (oldReasonTrim !== newReasonTrim) {
      changes.push({ field: "reason", label: "السبب", old: oldReasonTrim, new: newReasonTrim, at: now });
    }

    finance.incomeTransactions[id] = {
      ...existing,
      date,
      amount,
      reason: newReasonTrim,
      savedAt: now,
      history: prevHistory.concat(changes),
    };
    finance.bankBalance = finance.bankBalance + (amount - oldAmount);

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, transaction: finance.incomeTransactions[id], bankBalance: finance.bankBalance, pocketBalance: finance.pocketBalance, changes });
  } catch (err) {
    res.status(500).json({ error: "write_failed", detail: String(err) });
  }
});

app.delete("/api/finance/income/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    const existing = finance.incomeTransactions[id];
    if (!existing) return res.status(404).json({ error: "not_found" });

    delete finance.incomeTransactions[id];
    finance.bankBalance = finance.bankBalance - (Number(existing.amount) || 0);

    await writeJSONAtomic(FINANCE_FILE, finance);
    res.json({ ok: true, bankBalance: finance.bankBalance, pocketBalance: finance.pocketBalance });
  } catch (err) {
    res.status(500).json({ error: "delete_failed", detail: String(err) });
  }
});

// ---------------------------------------------------------------
// Backup — copies the three data files into /backups with a
// timestamp, so a bad edit or accidental import never destroys
// history. Triggered manually from the UI, and also automatically
// before any plan import.
// ---------------------------------------------------------------
app.post("/api/backup", async (req, res) => {
  try {
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(BACKUPS_DIR, stamp);
    fs.mkdirSync(backupDir, { recursive: true });

    const data = await readJSON(DATA_FILE, { entries: {} });
    const reviews = await readJSON(REVIEWS_FILE, {});
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    await writeJSONAtomic(path.join(backupDir, "data.json"), data);
    await writeJSONAtomic(path.join(backupDir, "reviews.json"), reviews);
    await writeJSONAtomic(path.join(backupDir, "finance.json"), finance);

    if (fs.existsSync(PLANS_DIR)) {
      const plansBackupDir = path.join(backupDir, "plans");
      fs.mkdirSync(plansBackupDir, { recursive: true });
      const files = (await fsp.readdir(PLANS_DIR)).filter((f) =>
        f.endsWith(".json")
      );
      for (const f of files) {
        await fsp.copyFile(
          path.join(PLANS_DIR, f),
          path.join(plansBackupDir, f)
        );
      }
    }

    res.json({ ok: true, backupPath: backupDir });
  } catch (err) {
    res.status(500).json({ error: "backup_failed", detail: String(err) });
  }
});

// Full export bundle for download from the browser (JSON blob).
app.get("/api/export", async (req, res) => {
  try {
    const data = await readJSON(DATA_FILE, { entries: {} });
    const reviews = await readJSON(REVIEWS_FILE, {});
    const finance = normalizeFinance(await readJSON(FINANCE_FILE, emptyFinance()));
    ensureDirs();
    const files = (await fsp.readdir(PLANS_DIR)).filter((f) =>
      f.endsWith(".json")
    );
    const plans = [];
    for (const f of files) {
      const plan = await readJSON(path.join(PLANS_DIR, f), null);
      if (plan) plans.push(plan);
    }
    res.json({
      exportedAt: new Date().toISOString(),
      entries: data.entries,
      reviews,
      plans,
      finance,
    });
  } catch (err) {
    res.status(500).json({ error: "export_failed", detail: String(err) });
  }
});

ensureDirs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Tracker running at http://localhost:${PORT}`)
);

module.exports = app;
