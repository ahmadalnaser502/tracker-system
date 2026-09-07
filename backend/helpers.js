/**
 * Finance & data helper functions — pure logic, no I/O, no Express.
 * ---------------------------------------------------------------
 * Extracted from server.js so this logic can be unit-tested in
 * isolation (Jest can `require` these functions directly, without
 * needing to spin up an HTTP server or touch the filesystem).
 *
 * Nothing in this file reads/writes files or touches req/res —
 * that responsibility stays in server.js.
 */

// Daily expense categories tracked once per day (single amount each).
const DAILY_EXPENSE_KEYS = ["groceries", "fruitsVeg", "clothing", "car", "market"];
// Monthly income/expense line items, entered manually each month.
const MONTHLY_EXPENSE_KEYS = [
  "salary",
  "electricity",
  "water",
  "internet",
  "phoneLine1",
  "phoneLine2",
];
// Which monthly keys are income (added) vs. expense (subtracted) against
// the bank balance. Anything not listed here is treated as an expense.
// "salary" here means "مصروف ختام" (a recurring transfer/closing expense),
// not the person's actual income — so it is intentionally NOT in this set.
const MONTHLY_INCOME_KEYS = new Set([]);

// Human-readable Arabic labels for the built-in keys, used only for
// history entries (so a report reads "المواد التموينية: 40 -> 45" instead
// of "groceries: 40 -> 45"). Custom category labels come from the
// category record itself.
const DAILY_KEY_LABELS_AR = {
  groceries: "المواد التموينية",
  fruitsVeg: "فواكه وخضار",
  clothing: "كسوة وملابس",
  car: "سيارة",
  market: "بقالة",
};
const MONTHLY_KEY_LABELS_AR = {
  salary: "مصروف ختام",
  electricity: "فاتورة كهرباء",
  water: "فاتورة ماء",
  internet: "فاتورة إنترنت",
  phoneLine1: "خط تلفون ختام",
  phoneLine2: "خط تلفوني",
};

function emptyFinance() {
  return {
    bankBalance: null, // null = not initialized yet. Increased only by income.
    bankInitializedAt: null,
    pocketBalance: 0, // cash on hand. Always starts at 0 — never manually initialized.
    dailyExpenses: {}, // { "YYYY-MM-DD": { groceries, fruitsVeg, clothing, car, market, ...custom } }
    monthlyExpenses: {}, // { "YYYY-MM": { salary, electricity, water, internet, phoneLine1, phoneLine2, ...custom } }
    customCategories: {
      daily: [], // [{ key, label }]
      monthly: [], // [{ key, label, income }]
    },
    incomeTransactions: {}, // { "txn_<id>": { id, date, amount, reason, savedAt } }
  };
}

function normalizeFinance(finance) {
  // Backfills fields for finance.json files saved before these features
  // existed, so older data never breaks on read.
  if (!finance.customCategories) {
    finance.customCategories = { daily: [], monthly: [] };
  }
  if (!Array.isArray(finance.customCategories.daily)) finance.customCategories.daily = [];
  if (!Array.isArray(finance.customCategories.monthly)) finance.customCategories.monthly = [];
  if (!finance.incomeTransactions || typeof finance.incomeTransactions !== "object") {
    finance.incomeTransactions = {};
  }
  if (typeof finance.pocketBalance !== "number" || Number.isNaN(finance.pocketBalance)) {
    finance.pocketBalance = 0;
  }
  return finance;
}

// Total balance shown to the user everywhere — bank + pocket combined.
function totalBalance(finance) {
  const bank = finance.bankBalance === null || finance.bankBalance === undefined ? 0 : finance.bankBalance;
  return bank + (finance.pocketBalance || 0);
}

function slugifyKey(label, existingKeys) {
  // Custom category keys are auto-generated from the label so the
  // client never has to invent or transmit one. Falls back to a
  // short random suffix on collision (e.g. two categories named
  // identically, or a label with no Latin/number characters at all).
  const base =
    String(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "_")
      .replace(/^_+|_+$/g, "") || "item";
  let key = `custom_${base}`;
  let i = 2;
  while (existingKeys.has(key)) {
    key = `custom_${base}_${i}`;
    i += 1;
  }
  return key;
}

function allDailyKeys(finance) {
  return DAILY_EXPENSE_KEYS.concat(finance.customCategories.daily.map((c) => c.key));
}

function allMonthlyKeys(finance) {
  return MONTHLY_EXPENSE_KEYS.concat(finance.customCategories.monthly.map((c) => c.key));
}

function dailyLabels(finance) {
  const labels = { ...DAILY_KEY_LABELS_AR };
  finance.customCategories.daily.forEach((c) => (labels[c.key] = c.label));
  return labels;
}

function monthlyLabels(finance) {
  const labels = { ...MONTHLY_KEY_LABELS_AR };
  finance.customCategories.monthly.forEach((c) => (labels[c.key] = c.label));
  return labels;
}

function sumDailyEntry(entry, keys) {
  if (!entry) return 0;
  return keys.reduce((s, k) => s + (Number(entry[k]) || 0), 0);
}

// Net effect on bank balance of one monthly entry: income adds, expenses subtract.
function netMonthlyEntry(entry, keys, incomeKeys) {
  if (!entry) return 0;
  return keys.reduce((s, k) => {
    const v = Number(entry[k]) || 0;
    return s + (incomeKeys.has(k) ? v : -v);
  }, 0);
}

// Builds history log entries for every field that actually changed value
// between an old and new expense/income entry. Used for daily entries,
// monthly entries, and income transactions alike, so edits are never
// silent — the balance changes AND the "what changed, from what, to what,
// when" record is kept alongside it.
function diffHistory(oldEntry, newEntry, keys, labels) {
  const changes = [];
  const now = new Date().toISOString();
  keys.forEach((k) => {
    const oldVal = Number(oldEntry?.[k]) || 0;
    const newVal = Number(newEntry?.[k]) || 0;
    if (oldVal !== newVal) {
      changes.push({
        field: k,
        label: (labels && labels[k]) || k,
        old: oldVal,
        new: newVal,
        at: now,
      });
    }
  });
  return changes;
}

module.exports = {
  DAILY_EXPENSE_KEYS,
  MONTHLY_EXPENSE_KEYS,
  MONTHLY_INCOME_KEYS,
  DAILY_KEY_LABELS_AR,
  MONTHLY_KEY_LABELS_AR,
  emptyFinance,
  normalizeFinance,
  totalBalance,
  slugifyKey,
  allDailyKeys,
  allMonthlyKeys,
  dailyLabels,
  monthlyLabels,
  sumDailyEntry,
  netMonthlyEntry,
  diffHistory,
};