/**
 * API client — thin wrapper around fetch() for the backend routes
 * defined in backend/server.js. No caching, no local persistence:
 * the server + D:\PersonalSystem\Tracker is the single source of
 * truth for everything in this system.
 */
const Api = (() => {

  async function request(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || body.error || detail;
      } catch (_) {}
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json();
  }

  return {
    health: () => request("/api/health"),

    getData: () => request("/api/data"),
    saveEntry: (date, entry) =>
      request("/api/entry", {
        method: "POST",
        body: JSON.stringify({ date, entry }),
      }),

    getPlans: () => request("/api/plans"),
    getPlan: (weekStart) => request(`/api/plans/${weekStart}`),
    savePlan: (plan) =>
      request("/api/plans", {
        method: "POST",
        body: JSON.stringify(plan),
      }),
    deletePlan: (weekStart) =>
      request(`/api/plans/${weekStart}`, { method: "DELETE" }),

    getReviews: () => request("/api/reviews"),
    saveReview: (weekStart, review) =>
      request("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ weekStart, review }),
      }),

    backup: () => request("/api/backup", { method: "POST" }),
    exportUrl: () => "/api/export",

    getFinance: () => request("/api/finance"),
    initBankBalance: (amount, force) =>
      request("/api/finance/bank-init", {
        method: "POST",
        body: JSON.stringify({ amount, force: Boolean(force) }),
      }),
    transferFunds: (direction, amount) =>
      request("/api/finance/transfer", {
        method: "POST",
        body: JSON.stringify({ direction, amount }),
      }),
    saveDailyExpenses: (date, expenses) =>
      request("/api/finance/daily", {
        method: "POST",
        body: JSON.stringify({ date, expenses }),
      }),
    saveMonthlyExpenses: (month, entry) =>
      request("/api/finance/monthly", {
        method: "POST",
        body: JSON.stringify({ month, entry }),
      }),
    addFinanceCategory: (scope, label, income) =>
      request("/api/finance/categories", {
        method: "POST",
        body: JSON.stringify({ scope, label, income: Boolean(income) }),
      }),
    deleteFinanceCategory: (scope, key) =>
      request(`/api/finance/categories/${scope}/${encodeURIComponent(key)}`, {
        method: "DELETE",
      }),
    addIncomeTransaction: (date, amount, reason) =>
      request("/api/finance/income", {
        method: "POST",
        body: JSON.stringify({ date, amount, reason }),
      }),
    updateIncomeTransaction: (id, date, amount, reason) =>
      request(`/api/finance/income/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ date, amount, reason }),
      }),
    deleteIncomeTransaction: (id) =>
      request(`/api/finance/income/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };

})();
