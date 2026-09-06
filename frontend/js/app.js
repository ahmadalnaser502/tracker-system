/**
 * Personal Development & Life Tracking System — Frontend logic.
 *
 * State model:
 *   - allEntries: { "YYYY-MM-DD": entry } loaded once from /api/data,
 *     refreshed after every save.
 *   - allPlans: array of weekly plan objects loaded from /api/plans.
 *   - allReviews: { weekStart: review } loaded from /api/reviews.
 *
 * A "week" always starts on Saturday (Ahmad's week), identified by
 * its Saturday date in YYYY-MM-DD form — this is the `weekStart`
 * key used consistently across plans, reviews, and dashboard math.
 */

const App = (() => {

  let allEntries = {};
  let allPlans = [];
  let allReviews = {};
  let financeData = { bankBalance: null, pocketBalance: 0, dailyExpenses: {}, monthlyExpenses: {}, customCategories: { daily: [], monthly: [] }, incomeTransactions: {} };

  let currentLogDate = todayString();
  let currentPlanWeekStart = weekStartOf(new Date());
  let currentDashWeekStart = weekStartOf(new Date());
  let currentMood = null;

  let currentFinDate = todayString();
  let currentFinWeekStart = weekStartOf(new Date());
  let currentFinMonth = todayString().slice(0, 7);
  let currentReportMonth = todayString().slice(0, 7);

  const DAILY_EXPENSE_FIELDS = [
    { key: "groceries", id: "expGroceries", label: "المواد التموينية" },
    { key: "fruitsVeg", id: "expFruitsVeg", label: "فواكه وخضار" },
    { key: "clothing", id: "expClothing", label: "كسوة وملابس" },
    { key: "car", id: "expCar", label: "سيارة" },
    { key: "market", id: "expMarket", label: "بقالة" },
  ];

  const MONTHLY_EXPENSE_FIELDS = [
    { key: "salary", id: "expSalary", label: "مصروف ختام" },
    { key: "electricity", id: "expElectricity", label: "فاتورة كهرباء" },
    { key: "water", id: "expWater", label: "فاتورة ماء" },
    { key: "internet", id: "expInternet", label: "فاتورة إنترنت" },
    { key: "phoneLine1", id: "expPhoneLine1", label: "خط تلفون ختام" },
    { key: "phoneLine2", id: "expPhoneLine2", label: "خط تلفوني" },
  ];

  const WEEKDAY_NAMES_AR = [
    "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"
  ];

  // Rotating daily dhikr — cycles through a fixed 4-item sequence based
  // on the absolute day count, so it's stable and deterministic per date
  // (not tied to session/login, and doesn't need to be saved anywhere).
  const ROTATING_DHIKR = [
    "سبحان الله وبحمده سبحان الله العظيم",
    "لا حول ولا قوة إلا بالله",
    "استغفر الله وأتوب إليه",
    "لا إله إلا الله",
  ];

  // Weekly dhikr — fixed per weekday (JS getDay(): Sun=0..Sat=6).
  const WEEKLY_DHIKR = {
    0: "لا حول ولا قوة إلا بالله", // الأحد
    5: "اللهم صل على محمد",         // الجمعة
  };
  const WEEKLY_DHIKR_DEFAULT = "—";

  /* ============================================================
     DATE HELPERS
  ============================================================ */

  function todayString() {
    return formatDate(new Date());
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  // Week starts Saturday. JS getDay(): Sun=0 .. Sat=6.
  function weekStartOf(date) {
    const day = date.getDay();
    const diff = (day + 1) % 7; // days since last Saturday
    const sat = new Date(date);
    sat.setDate(date.getDate() - diff);
    return formatDate(sat);
  }

  function weekDates(weekStart) {
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i));
    return dates;
  }

  function weekRangeLabel(weekStart) {
    const end = addDays(weekStart, 6);
    return `${weekStart} → ${end}`;
  }

  const MONTH_NAMES_AR = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  function monthKeyOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function addMonths(monthKey, n) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return monthKeyOf(d);
  }

  function monthLabel(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    return `${MONTH_NAMES_AR[m - 1]} ${y}`;
  }

  function formatCurrency(n) {
    return `${Number(n || 0).toLocaleString("ar", { maximumFractionDigits: 2 })} د.أ`;
  }

  // Combines the fixed fields with the user's custom categories into one
  // list the rest of the finance code (form rendering, totals, tables,
  // export) can iterate over uniformly.
  function allDailyFields() {
    const custom = (financeData.customCategories?.daily || []).map((c) => ({
      key: c.key,
      id: `expCustom_${c.key}`,
      label: c.label,
      custom: true,
    }));
    return DAILY_EXPENSE_FIELDS.concat(custom);
  }

  function allMonthlyFields() {
    const custom = (financeData.customCategories?.monthly || []).map((c) => ({
      key: c.key,
      id: `expCustom_${c.key}`,
      label: c.label,
      income: Boolean(c.income),
      custom: true,
    }));
    return MONTHLY_EXPENSE_FIELDS.concat(custom);
  }

  /* ============================================================
     NAVIGATION
  ============================================================ */

  /* ============================================================
     THEME (dark/light) — manual toggle, persisted in localStorage.
     Applied as early as possible (before first paint of content)
     to avoid a flash of the wrong theme.
  ============================================================ */

  const THEME_STORAGE_KEY = "tracker_theme";

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {
      /* localStorage unavailable — theme just won't persist across reloads */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const icon = document.getElementById("themeToggleIcon");
    const label = document.getElementById("themeToggleLabel");
    if (theme === "light") {
      if (icon) icon.textContent = "☀";
      if (label) label.textContent = "فاتح";
    } else {
      if (icon) icon.textContent = "☾";
      if (label) label.textContent = "داكن";
    }
  }

  function initTheme() {
    const stored = getStoredTheme();
    applyTheme(stored === "light" ? "light" : "dark");

    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
        const next = current === "light" ? "dark" : "light";
        applyTheme(next);
        storeTheme(next);
      });
    }
  }

  function initNav() {
    document.querySelectorAll(".pagenav-btn").forEach((btn) => {
      btn.addEventListener("click", () => goToPage(btn.dataset.page));
    });
    document.querySelectorAll(".subtab-btn").forEach((btn) => {
      btn.addEventListener("click", () => goToSubtab(btn.dataset.subtab));
    });
  }

  function goToPage(page) {
    document.querySelectorAll(".pagenav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.page === page)
    );
    document.querySelectorAll(".page").forEach((p) =>
      p.classList.toggle("active", p.id === `page-${page}`)
    );
    // Re-render whichever subtab is currently active within the page
    // being shown, since data may have changed since it was last open.
    if (page === "tracking") {
      const activeSub = document.querySelector('.subtabs[data-group="tracking"] .subtab-btn.active');
      renderTrackingSubtab(activeSub ? activeSub.dataset.subtab : "log");
    }
    if (page === "finance") renderFinancePage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Generic sub-tab switcher. Every subtab button/panel pair shares a
  // data-group (e.g. "tracking", "fin-expenses", "fin-reports") so
  // multiple independent tab strips can coexist on the same page
  // without interfering with each other.
  // Tracks which subtabs have already been rendered at least once, so
  // switching tabs back and forth never wipes out an in-progress edit —
  // a subtab's DOM is only (re)built the first time it's opened, or
  // explicitly after a save/mutation elsewhere in the app.
  const renderedSubtabs = new Set();

  function goToSubtab(subtab) {
    const btn = document.querySelector(`.subtab-btn[data-subtab="${subtab}"]`);
    if (!btn) return;
    const nav = btn.closest(".subtabs");
    const group = nav ? nav.dataset.group : null;
    if (!group) return;

    document.querySelectorAll(`.subtabs[data-group="${group}"] .subtab-btn`).forEach((b) =>
      b.classList.toggle("active", b.dataset.subtab === subtab)
    );
    document.querySelectorAll(`.subtab-panel[data-group="${group}"]`).forEach((p) =>
      p.classList.toggle("active", p.id === `subtab-${subtab}`)
    );

    if (group === "tracking" && !renderedSubtabs.has(subtab)) {
      renderTrackingSubtab(subtab);
      renderedSubtabs.add(subtab);
    }
    if (group === "finance" && !renderedSubtabs.has(subtab)) {
      renderFinanceSubtab(subtab);
      renderedSubtabs.add(subtab);
    }
  }

  // Renders only the finance subtab that was just opened, instead of
  // the whole finance page. Rebuilding every subtab's DOM on every
  // switch (the old renderFinancePage()) wiped out any unsaved input
  // in the daily/monthly fields whenever you switched tabs and back —
  // this keeps each subtab's own state untouched unless its own data
  // actually changed.
  function renderFinanceSubtab(subtab) {
    if (subtab === "fin-daily") {
      renderDailyFieldGrid();
      loadDailyExpenseFields();
    } else if (subtab === "fin-monthly") {
      renderMonthlyFieldGrid();
      renderFinanceMonthUI();
    } else if (subtab === "fin-income") {
      renderIncomeList();
    } else if (subtab === "fin-board") {
      renderFinanceDashboard();
    } else if (subtab === "fin-reports") {
      renderReportMonthLabel();
      renderFinanceDashboard();
    }
  }


  // Renders whichever of the 3 tracking subtabs was just opened. The
  // daily log itself doesn't need a render call (it's populated by
  // loadDailyEntry() during init/date changes), but plan/dashboard
  // build their DOM from allPlans/allEntries each time they're shown.
  function renderTrackingSubtab(subtab) {
    if (subtab === "plan") renderPlanPage();
    if (subtab === "dashboard") renderDashboardPage();
  }

  /* ============================================================
     CONNECTION STATUS
  ============================================================ */

  async function checkConnection() {
    const dot = document.getElementById("connDot");
    const label = document.getElementById("connLabel");
    try {
      const health = await Api.health();
      dot.className = "dot ok";
      label.textContent = `متصل — ${health.dataDir}`;
    } catch (err) {
      dot.className = "dot err";
      label.textContent = "تعذر الاتصال بالسيرفر";
    }
  }

  /* ============================================================
     DAILY LOG — FIELD HELPERS
  ============================================================ */

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
  }
  function getNum(id) {
    const v = getVal(id);
    return v === "" ? null : Number(v);
  }
  function setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  }
  function getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  /* ============================================================
     DAILY LOG — LOAD / RENDER
  ============================================================ */

  function initDateBar() {
    const dateInput = document.getElementById("logDate");
    dateInput.value = currentLogDate;
    updateWeekdayLabel();

    dateInput.addEventListener("change", () => {
      currentLogDate = dateInput.value;
      updateWeekdayLabel();
      loadDailyEntry();
    });

    document.getElementById("dateBack").addEventListener("click", () => {
      currentLogDate = addDays(currentLogDate, -1);
      dateInput.value = currentLogDate;
      updateWeekdayLabel();
      loadDailyEntry();
    });

    document.getElementById("dateFwd").addEventListener("click", () => {
      currentLogDate = addDays(currentLogDate, 1);
      dateInput.value = currentLogDate;
      updateWeekdayLabel();
      loadDailyEntry();
    });

    document.getElementById("dateToday").addEventListener("click", () => {
      currentLogDate = todayString();
      dateInput.value = currentLogDate;
      updateWeekdayLabel();
      loadDailyEntry();
    });
  }

  function updateWeekdayLabel() {
    const d = parseDate(currentLogDate);
    document.getElementById("dateWeekday").textContent =
      WEEKDAY_NAMES_AR[d.getDay()];
  }

  // Absolute day index for currentLogDate — used to rotate the daily
  // dhikr deterministically regardless of which date is being viewed.
  function dayIndexOf(dateStr) {
    const d = parseDate(dateStr);
    return Math.floor(d.getTime() / 86400000);
  }

  function updateDhikrDisplay() {
    const rotatingEl = document.getElementById("dhikrRotating");
    const weeklyEl = document.getElementById("dhikrWeekly");
    if (!rotatingEl || !weeklyEl) return;

    const idx = ((dayIndexOf(currentLogDate) % ROTATING_DHIKR.length) + ROTATING_DHIKR.length) % ROTATING_DHIKR.length;
    rotatingEl.textContent = ROTATING_DHIKR[idx];

    const weekday = parseDate(currentLogDate).getDay();
    weeklyEl.textContent = WEEKLY_DHIKR[weekday] || WEEKLY_DHIKR_DEFAULT;
  }

  function initMood() {
    document.querySelectorAll(".mood-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentMood = btn.dataset.mood;
        updateMoodUI();
      });
    });
  }

  function updateMoodUI() {
    document.querySelectorAll(".mood-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mood === currentMood);
    });
  }

  function activePlanForDate(dateStr) {
    const ws = weekStartOf(parseDate(dateStr));
    return allPlans.find((p) => p.weekStart === ws) || null;
  }

  function renderTracksForEntry(entry) {
    const container = document.getElementById("tracksContainer");
    const plan = activePlanForDate(currentLogDate);

    if (!plan || !Array.isArray(plan.topics) || plan.topics.length === 0) {
      container.innerHTML =
        '<div class="empty-hint">لا توجد خطة أسبوع نشطة. اذهب إلى «خطة الأسبوع» وارفع ملف JSON.</div>';
      return;
    }

    const savedTracks = (entry && entry.tracks) || {};

    container.innerHTML = plan.topics
      .map((topic, idx) => {
        const key = topic.id || `topic_${idx}`;
        const saved = savedTracks[key] || {};
        return `
          <div class="track-card">
            <div class="track-card-head">
              <span class="track-name">${escapeHTML(topic.name)}</span>
              <span class="track-target">الهدف: ${Number(topic.targetHours || 0)} س / أسبوع</span>
            </div>
            <div class="track-fields">
              <label for="track-hours-${idx}">ساعات اليوم</label>
              <input type="number" min="0" step="0.25" id="track-hours-${idx}"
                     data-key="${key}" class="track-hours-input"
                     value="${saved.hours ?? ""}" placeholder="0">

              <label for="track-note-${idx}">ملاحظة</label>
              <textarea id="track-note-${idx}" data-key="${key}"
                        class="track-note-input" placeholder="ماذا تعلمت اليوم؟">${escapeHTML(saved.note || "")}</textarea>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function collectTracks() {
    const tracks = {};
    document.querySelectorAll(".track-hours-input").forEach((input) => {
      const key = input.dataset.key;
      const noteEl = document.querySelector(
        `.track-note-input[data-key="${CSS.escape(key)}"]`
      );
      tracks[key] = {
        hours: input.value === "" ? 0 : Number(input.value),
        note: noteEl ? noteEl.value.trim() : "",
      };
    });
    return tracks;
  }

  function loadDailyEntry() {
    const entry = allEntries[currentLogDate] || {};

    updateDhikrDisplay();

    setChecked("morningAdhkar", entry.morningAdhkar);
    setChecked("eveningAdhkar", entry.eveningAdhkar);
    setChecked("sunnahFajr", entry.sunnahFajr);
    setChecked("sunnahDhuhrBefore", entry.sunnahDhuhrBefore);
    setChecked("sunnahDhuhrAfter", entry.sunnahDhuhrAfter);
    setChecked("sunnahMaghrib", entry.sunnahMaghrib);
    setChecked("sunnahIsha", entry.sunnahIsha);
    setChecked("duhaPrayer", entry.duhaPrayer);
    setChecked("postPrayerFajr", entry.postPrayerFajr);
    setChecked("postPrayerDhuhr", entry.postPrayerDhuhr);
    setChecked("postPrayerAsr", entry.postPrayerAsr);
    setChecked("postPrayerMaghrib", entry.postPrayerMaghrib);
    setChecked("postPrayerIsha", entry.postPrayerIsha);
    setVal("quranMinutes", entry.quranMinutes);

    setVal("exerciseMinutes", entry.exerciseMinutes);

    currentMood = entry.mood || null;
    updateMoodUI();

    setVal("dailyNote", entry.dailyNote);

    setVal("englishMinutes", entry.englishMinutes);
    setVal("englishWords", entry.englishWords);

    setVal("podcastName", entry.podcastName);
    setVal("podcastMinutes", entry.podcastMinutes);
    setVal("readingName", entry.readingName);
    setVal("readingPages", entry.readingPages);

    renderTracksForEntry(entry);

    document.getElementById("saveStatus").textContent = entry.savedAt
      ? `آخر حفظ: ${new Date(entry.savedAt).toLocaleString("ar")}`
      : "لم يُحفظ بعد";
    document.getElementById("saveStatus").className = "save-status";
  }

  async function saveDailyEntry() {
    const entry = {
      morningAdhkar: getChecked("morningAdhkar"),
      eveningAdhkar: getChecked("eveningAdhkar"),
      sunnahFajr: getChecked("sunnahFajr"),
      sunnahDhuhrBefore: getChecked("sunnahDhuhrBefore"),
      sunnahDhuhrAfter: getChecked("sunnahDhuhrAfter"),
      sunnahMaghrib: getChecked("sunnahMaghrib"),
      sunnahIsha: getChecked("sunnahIsha"),
      duhaPrayer: getChecked("duhaPrayer"),
      postPrayerFajr: getChecked("postPrayerFajr"),
      postPrayerDhuhr: getChecked("postPrayerDhuhr"),
      postPrayerAsr: getChecked("postPrayerAsr"),
      postPrayerMaghrib: getChecked("postPrayerMaghrib"),
      postPrayerIsha: getChecked("postPrayerIsha"),
      quranMinutes: getNum("quranMinutes"),

      exerciseMinutes: getNum("exerciseMinutes"),

      mood: currentMood,
      dailyNote: getVal("dailyNote").trim(),

      englishMinutes: getNum("englishMinutes"),
      englishWords: getVal("englishWords").trim(),

      tracks: collectTracks(),

      podcastName: getVal("podcastName").trim(),
      podcastMinutes: getNum("podcastMinutes"),
      readingName: getVal("readingName").trim(),
      readingPages: getNum("readingPages"),
    };

    const statusEl = document.getElementById("saveStatus");
    statusEl.textContent = "جارٍ الحفظ…";
    statusEl.className = "save-status";

    try {
      await Api.saveEntry(currentLogDate, entry);
      allEntries[currentLogDate] = { ...entry, savedAt: new Date().toISOString() };
      statusEl.textContent = `✓ تم الحفظ — ${new Date().toLocaleTimeString("ar")}`;
      statusEl.className = "save-status ok";
    } catch (err) {
      statusEl.textContent = `تعذر الحفظ: ${err.message}`;
      statusEl.className = "save-status err";
    }
  }

  /* ============================================================
     WEEKLY PLAN PAGE
  ============================================================ */

  function initPlanPage() {
    document.getElementById("planWeekBack").addEventListener("click", () => {
      currentPlanWeekStart = addDays(currentPlanWeekStart, -7);
      renderPlanPage();
    });
    document.getElementById("planWeekFwd").addEventListener("click", () => {
      currentPlanWeekStart = addDays(currentPlanWeekStart, 7);
      renderPlanPage();
    });

    document.getElementById("planFileInput").addEventListener("change", handlePlanUpload);
    document.getElementById("downloadTemplateBtn").addEventListener("click", downloadPlanTemplate);
    document.getElementById("clearPlanBtn").addEventListener("click", handleClearPlan);
  }

  function renderPlanPage() {
    document.getElementById("planWeekLabel").textContent = weekRangeLabel(currentPlanWeekStart);
    const plan = allPlans.find((p) => p.weekStart === currentPlanWeekStart);
    const container = document.getElementById("planDisplay");

    if (!plan) {
      container.innerHTML = `
        <div class="plan-empty">
          لا توجد خطة مرفوعة لهذا الأسبوع.<br>
          ارفع ملف JSON من الأزرار أدناه — الخطة يضعها الموجّه بناءً على تقرير الأسبوع الماضي.
        </div>`;
      return;
    }

    const topicsHTML = (plan.topics || [])
      .map(
        (t) => `
        <div class="plan-topic-row">
          <div>
            <div class="plan-topic-name">${escapeHTML(t.name)}</div>
            ${t.goal ? `<div class="plan-topic-goal">${escapeHTML(t.goal)}</div>` : ""}
          </div>
          <div class="plan-topic-hours">${Number(t.targetHours || 0)} ساعة</div>
        </div>`
      )
      .join("");

    const prioritiesHTML = (plan.priorities || [])
      .map((p) => `<li>${escapeHTML(p)}</li>`)
      .join("");

    container.innerHTML = `
      <div class="plan-title-row">
        <h3>${escapeHTML(plan.title || "خطة الأسبوع")}</h3>
        <span class="plan-range">${escapeHTML(weekRangeLabel(plan.weekStart))}</span>
      </div>
      ${plan.mainGoal ? `<div class="plan-goal">${escapeHTML(plan.mainGoal)}</div>` : ""}

      <div class="plan-section-title">المسارات (Tracks)</div>
      ${topicsHTML || '<div class="empty-hint">لا توجد مسارات في هذه الخطة.</div>'}

      ${
        prioritiesHTML
          ? `<div class="plan-section-title">الأولويات</div><ol class="plan-priorities">${prioritiesHTML}</ol>`
          : ""
      }

      ${plan.note ? `<div class="plan-note">${escapeHTML(plan.note)}</div>` : ""}
    `;
  }

  async function handlePlanUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const text = await file.text();
    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      alert("ملف JSON غير صالح.");
      event.target.value = "";
      return;
    }

    if (!plan.weekStart || !Array.isArray(plan.topics)) {
      alert("الملف يجب أن يحتوي على weekStart و topics على الأقل.");
      event.target.value = "";
      return;
    }

    try {
      await Api.backup();
      await Api.savePlan(plan);
      await reloadPlans();
      currentPlanWeekStart = plan.weekStart;
      renderPlanPage();
      alert("✓ تم تحميل خطة الأسبوع.");
    } catch (err) {
      alert(`تعذر حفظ الخطة: ${err.message}`);
    }
    event.target.value = "";
  }

  async function handleClearPlan() {
    const plan = allPlans.find((p) => p.weekStart === currentPlanWeekStart);
    if (!plan) return;
    if (!confirm("هل تريد حذف خطة هذا الأسبوع؟")) return;
    try {
      await Api.deletePlan(currentPlanWeekStart);
      await reloadPlans();
      renderPlanPage();
    } catch (err) {
      alert(`تعذر الحذف: ${err.message}`);
    }
  }

  function downloadPlanTemplate() {
    const template = {
      weekStart: currentPlanWeekStart,
      title: "خطة الأسبوع",
      mainGoal: "اكتب هنا الهدف الرئيسي لهذا الأسبوع",
      topics: [
        {
          id: "topic_1",
          name: "Linux",
          goal: "إدارة الصلاحيات + العمليات + الملفات",
          targetHours: 7,
        },
        {
          id: "topic_2",
          name: "Networking",
          goal: "أساسيات TCP/IP + DNS + Subnetting",
          targetHours: 5,
        },
      ],
      priorities: [
        "التطبيق العملي أهم من المشاهدة فقط",
        "توثيق ما تتعلمه في ملاحظة كل يوم",
      ],
      note: "الهدف هو الالتزام بالوقت والاستمرارية، لا إتمام 100٪.",
    };
    downloadFile(
      JSON.stringify(template, null, 2),
      `plan_${currentPlanWeekStart}.json`,
      "application/json"
    );
  }

  async function reloadPlans() {
    const res = await Api.getPlans();
    allPlans = res.plans || [];
  }

  /* ============================================================
     DASHBOARD PAGE
  ============================================================ */

  function initDashboardPage() {
    document.getElementById("dashWeekBack").addEventListener("click", () => {
      currentDashWeekStart = addDays(currentDashWeekStart, -7);
      renderDashboardPage();
    });
    document.getElementById("dashWeekFwd").addEventListener("click", () => {
      currentDashWeekStart = addDays(currentDashWeekStart, 7);
      renderDashboardPage();
    });
    document.getElementById("saveReviewBtn").addEventListener("click", saveReview);
    document.getElementById("exportWeekBtn").addEventListener("click", exportWeekReport);
    document.getElementById("exportAllBtn").addEventListener("click", exportFullBackup);
  }

  function renderDashboardPage() {
    document.getElementById("dashWeekLabel").textContent = weekRangeLabel(currentDashWeekStart);

    const dates = weekDates(currentDashWeekStart);
    const entries = dates.map((d) => allEntries[d] || null);
    const plan = allPlans.find((p) => p.weekStart === currentDashWeekStart) || null;

    renderStatGrid(entries, plan);
    renderTrackProgress(entries, plan);
    renderWeekTable(dates, entries, plan);
    loadReviewFields(currentDashWeekStart);
  }

  function renderStatGrid(entries, plan) {
    let englishMinutes = 0;
    let readingPages = 0;
    let exerciseMinutes = 0;
    let quranMinutes = 0;
    let trackHoursTotal = 0;

    entries.forEach((e) => {
      if (!e) return;
      englishMinutes += e.englishMinutes || 0;
      readingPages += e.readingPages || 0;
      exerciseMinutes += e.exerciseMinutes || 0;
      quranMinutes += e.quranMinutes || 0;
      if (e.tracks) {
        Object.values(e.tracks).forEach((t) => (trackHoursTotal += t.hours || 0));
      }
    });

    const planTargetTotal = plan
      ? (plan.topics || []).reduce((s, t) => s + Number(t.targetHours || 0), 0)
      : 0;

    const stats = [
      { label: "الإنجليزية", value: `${englishMinutes} د` },
      { label: "مسارات DevOps", value: planTargetTotal ? `${trackHoursTotal.toFixed(1)} / ${planTargetTotal} س` : `${trackHoursTotal.toFixed(1)} س` },
      { label: "القراءة", value: `${readingPages} صفحة` },
      { label: "الرياضة", value: `${exerciseMinutes} د` },
      { label: "القرآن", value: `${quranMinutes} د` },
    ];

    document.getElementById("statGrid").innerHTML = stats
      .map(
        (s) => `
        <div class="stat-card">
          <div class="stat-label">${s.label}</div>
          <div class="stat-value">${s.value}</div>
        </div>`
      )
      .join("");
  }

  function renderTrackProgress(entries, plan) {
    const container = document.getElementById("trackProgress");
    if (!plan || !plan.topics || plan.topics.length === 0) {
      container.innerHTML = '<div class="empty-hint">لا توجد خطة لهذا الأسبوع.</div>';
      return;
    }

    const totals = {};
    entries.forEach((e) => {
      if (!e || !e.tracks) return;
      Object.entries(e.tracks).forEach(([key, t]) => {
        totals[key] = (totals[key] || 0) + (t.hours || 0);
      });
    });

    container.innerHTML = plan.topics
      .map((topic, idx) => {
        const key = topic.id || `topic_${idx}`;
        const actual = totals[key] || 0;
        const target = Number(topic.targetHours || 0);
        const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
        const over = target && actual > target;
        return `
          <div>
            <div class="tp-row-head">
              <span class="tp-name">${escapeHTML(topic.name)}</span>
              <span class="tp-figs">${actual.toFixed(1)} / ${target} س — ${pct}%</span>
            </div>
            <div class="tp-bar"><div class="tp-bar-fill${over ? " over" : ""}" style="width:${pct}%"></div></div>
          </div>`;
      })
      .join("");
  }

  function renderWeekTable(dates, entries, plan) {
    const table = document.getElementById("weekTable");

    const rows = [
      {
        name: "English",
        fn: (e) => (e && e.englishMinutes ? `${e.englishMinutes}د` : "—"),
      },
    ];

    if (plan && plan.topics) {
      plan.topics.forEach((topic, idx) => {
        const key = topic.id || `topic_${idx}`;
        rows.push({
          name: topic.name,
          fn: (e) => (e && e.tracks && e.tracks[key] ? `${e.tracks[key].hours}س` : "—"),
        });
      });
    }

    rows.push(
      { name: "القراءة", fn: (e) => (e && e.readingPages ? `${e.readingPages}ص` : "—") },
      { name: "الرياضة", fn: (e) => (e && e.exerciseMinutes ? `${e.exerciseMinutes}د` : "—") }
    );

    const headerCells = dates
      .map((date) => {
        const d = parseDate(date);
        return `<th>${WEEKDAY_NAMES_AR[d.getDay()]}</th>`;
      })
      .join("");

    const bodyRows = rows
      .map((row) => {
        const cells = dates.map((date) => `<td>${row.fn(allEntries[date] || null)}</td>`).join("");
        return `<tr><td>${escapeHTML(row.name)}</td>${cells}</tr>`;
      })
      .join("");

    table.innerHTML = `<thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
  }

  /* ============================================================
     WEEKLY REVIEW
  ============================================================ */

  function loadReviewFields(weekStart) {
    const review = allReviews[weekStart] || {};
    setVal("reviewWins", review.wins);
    setVal("reviewLearned", review.learned);
    setVal("reviewProblems", review.problems);
    setVal("reviewContinue", review.continue_);
    setVal("reviewChange", review.change);
    setVal("reviewMemory", review.memory);
  }

  async function saveReview() {
    const review = {
      wins: getVal("reviewWins").trim(),
      learned: getVal("reviewLearned").trim(),
      problems: getVal("reviewProblems").trim(),
      continue_: getVal("reviewContinue").trim(),
      change: getVal("reviewChange").trim(),
      memory: getVal("reviewMemory").trim(),
    };
    const statusEl = document.getElementById("reviewSaveStatus");
    statusEl.textContent = "جارٍ الحفظ…";
    try {
      await Api.saveReview(currentDashWeekStart, review);
      allReviews[currentDashWeekStart] = review;
      statusEl.textContent = "✓ تم حفظ مراجعة الأسبوع";
      statusEl.className = "save-status ok";
    } catch (err) {
      statusEl.textContent = `تعذر الحفظ: ${err.message}`;
      statusEl.className = "save-status err";
    }
  }

  /* ============================================================
     EXPORT
  ============================================================ */

  // Builds and downloads an .xlsx workbook from a list of
  // { name, rows } sheets, where rows is an array-of-arrays
  // (first row = header). Requires the SheetJS (XLSX) library,
  // loaded globally via CDN in index.html.
  function downloadXlsx(sheets, filename) {
    if (typeof XLSX === "undefined") {
      alert("تعذر تحميل مكتبة Excel. تحقق من الاتصال بالإنترنت وحاول مجددًا.");
      return;
    }
    const wb = XLSX.utils.book_new();
    sheets.forEach((sheet) => {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportWeekReport() {
    const dates = weekDates(currentDashWeekStart);
    const entries = dates.map((d) => allEntries[d] || null);
    const plan = allPlans.find((p) => p.weekStart === currentDashWeekStart) || null;
    const review = allReviews[currentDashWeekStart] || {};

    let englishMinutes = 0, readingPages = 0;
    const trackTotals = {};

    entries.forEach((e) => {
      if (!e) return;
      englishMinutes += e.englishMinutes || 0;
      readingPages += e.readingPages || 0;
      if (e.tracks) {
        Object.entries(e.tracks).forEach(([key, t]) => {
          if (!trackTotals[key]) trackTotals[key] = { hours: 0, notes: [] };
          trackTotals[key].hours += t.hours || 0;
          if (t.note) trackTotals[key].notes.push(t.note);
        });
      }
    });

    const trackLines = plan
      ? plan.topics.map((topic, idx) => {
          const key = topic.id || `topic_${idx}`;
          const t = trackTotals[key] || { hours: 0, notes: [] };
          return `- ${topic.name}: ${t.hours.toFixed(1)} / ${topic.targetHours} ساعة${
            t.notes.length ? "\n  ملاحظات: " + t.notes.join(" | ") : ""
          }`;
        }).join("\n")
      : "لا توجد خطة لهذا الأسبوع.";

    const summary = `
تقرير الأسبوع: ${weekRangeLabel(currentDashWeekStart)}
=================================================

الإنجليزية: ${englishMinutes} دقيقة
القراءة: ${readingPages} صفحة

مسارات DevOps:
${trackLines}

مراجعة الأسبوع:
- ماذا أنجزت: ${review.wins || "—"}
- ما تعلمته: ${review.learned || "—"}
- ما أعاقني: ${review.problems || "—"}
- أريد الاستمرار على: ${review.continue_ || "—"}
- سأغيّر: ${review.change || "—"}
- ملاحظة للمستقبل: ${review.memory || "—"}
`.trim();

    const bundle = {
      summary,
      data: {
        weekStart: currentDashWeekStart,
        weekRange: weekRangeLabel(currentDashWeekStart),
        plan,
        entries: Object.fromEntries(dates.map((d, i) => [d, entries[i]])),
        review,
        totals: {
          englishMinutes,
          readingPages,
          trackTotals,
        },
      },
    };

    downloadFile(
      JSON.stringify(bundle, null, 2),
      `week_report_${currentDashWeekStart}.json`,
      "application/json"
    );
  }

  async function exportFullBackup() {
    try {
      const res = await fetch(Api.exportUrl());
      const data = await res.json();
      downloadFile(
        JSON.stringify(data, null, 2),
        `full_backup_${todayString()}.json`,
        "application/json"
      );
      await Api.backup();
    } catch (err) {
      alert(`تعذر التصدير: ${err.message}`);
    }
  }

  /* ============================================================
     FINANCE PAGE
  ============================================================ */

  function initFinancePage() {
    // Bank balance
    document.getElementById("bankInitBtn").addEventListener("click", handleBankInit);
    document.getElementById("transferToPocketBtn").addEventListener("click", () => handleTransfer("toPocket"));
    document.getElementById("transferToBankBtn").addEventListener("click", () => handleTransfer("toBank"));

    // Daily expenses date bar
    const finDateInput = document.getElementById("finDate");
    finDateInput.value = currentFinDate;
    updateFinDateWeekdayLabel();

    finDateInput.addEventListener("change", () => {
      currentFinDate = finDateInput.value;
      updateFinDateWeekdayLabel();
      loadDailyExpenseFields();
    });
    document.getElementById("finDateBack").addEventListener("click", () => {
      currentFinDate = addDays(currentFinDate, -1);
      finDateInput.value = currentFinDate;
      updateFinDateWeekdayLabel();
      loadDailyExpenseFields();
    });
    document.getElementById("finDateFwd").addEventListener("click", () => {
      currentFinDate = addDays(currentFinDate, 1);
      finDateInput.value = currentFinDate;
      updateFinDateWeekdayLabel();
      loadDailyExpenseFields();
    });
    document.getElementById("finDateToday").addEventListener("click", () => {
      currentFinDate = todayString();
      finDateInput.value = currentFinDate;
      updateFinDateWeekdayLabel();
      loadDailyExpenseFields();
    });
    document.getElementById("saveDailyExpBtn").addEventListener("click", saveDailyExpenses);
    document.getElementById("addDailyCategoryBtn").addEventListener("click", () =>
      handleAddCategory("daily")
    );

    // Monthly expenses month bar
    document.getElementById("finMonthBack").addEventListener("click", () => {
      currentFinMonth = addMonths(currentFinMonth, -1);
      renderFinanceMonthUI();
    });
    document.getElementById("finMonthFwd").addEventListener("click", () => {
      currentFinMonth = addMonths(currentFinMonth, 1);
      renderFinanceMonthUI();
    });
    document.getElementById("saveMonthlyExpBtn").addEventListener("click", saveMonthlyExpenses);
    document.getElementById("addMonthlyCategoryBtn").addEventListener("click", () =>
      handleAddCategory("monthly")
    );

    // Dashboard week navigation
    document.getElementById("finWeekBack").addEventListener("click", () => {
      currentFinWeekStart = addDays(currentFinWeekStart, -7);
      renderFinanceDashboard();
    });
    document.getElementById("finWeekFwd").addEventListener("click", () => {
      currentFinWeekStart = addDays(currentFinWeekStart, 7);
      renderFinanceDashboard();
    });

    // Extra income
    const incomeDateInput = document.getElementById("incomeDate");
    incomeDateInput.value = todayString();
    document.getElementById("addIncomeBtn").addEventListener("click", handleAddIncome);

    // Reports — weekly export follows the dashboard week above.
    document.getElementById("exportFinanceWeekBtn").addEventListener("click", exportFinanceWeekReport);
    document.getElementById("exportFinanceWeekExcelBtn").addEventListener("click", exportFinanceWeekReportExcel);

    // Reports — monthly export has its own independent month picker,
    // separate from the "المصاريف الشهرية" entry-form month.
    document.getElementById("reportMonthBack").addEventListener("click", () => {
      currentReportMonth = addMonths(currentReportMonth, -1);
      renderReportMonthLabel();
    });
    document.getElementById("reportMonthFwd").addEventListener("click", () => {
      currentReportMonth = addMonths(currentReportMonth, 1);
      renderReportMonthLabel();
    });
    document.getElementById("exportFinanceMonthBtn").addEventListener("click", exportFinanceMonthReport);
    document.getElementById("exportFinanceMonthExcelBtn").addEventListener("click", exportFinanceMonthReportExcel);
  }

  function renderReportMonthLabel() {
    document.getElementById("reportMonthLabel").textContent = monthLabel(currentReportMonth);
  }

  function updateFinDateWeekdayLabel() {
    const d = parseDate(currentFinDate);
    document.getElementById("finDateWeekday").textContent = WEEKDAY_NAMES_AR[d.getDay()];
  }

  function updateBalanceStrips() {
    const bankEl = document.getElementById("bankBalanceValue");
    const btn = document.getElementById("bankInitBtn");
    const pocketEl = document.getElementById("pocketBalanceValue");
    const totalEl = document.getElementById("totalBalanceValue");

    if (financeData.bankBalance === null || financeData.bankBalance === undefined) {
      bankEl.textContent = "لم يُعيَّن بعد";
      bankEl.className = "bank-strip-value unset";
      btn.textContent = "تعيين الرصيد الابتدائي";
      totalEl.textContent = "—";
    } else {
      bankEl.textContent = formatCurrency(financeData.bankBalance);
      bankEl.className = "bank-strip-value" + (financeData.bankBalance < 0 ? " negative" : "");
      btn.textContent = "إعادة تعيين الرصيد الابتدائي";

      const pocket = financeData.pocketBalance || 0;
      const total = financeData.bankBalance + pocket;
      totalEl.textContent = formatCurrency(total);
      totalEl.className = "bank-strip-value" + (total < 0 ? " negative" : "");
    }

    const pocket = financeData.pocketBalance || 0;
    pocketEl.textContent = formatCurrency(pocket);
    pocketEl.className = "bank-strip-value" + (pocket < 0 ? " negative" : "");
  }

  async function handleBankInit() {
    const isReset = financeData.bankBalance !== null && financeData.bankBalance !== undefined;
    const promptMsg = isReset
      ? `الرصيد الحالي هو ${formatCurrency(financeData.bankBalance)}. أدخل رصيدًا ابتدائيًا جديدًا (سيُعاد ضبط نقطة البداية فقط، دون حذف السجل):`
      : "أدخل الرصيد الابتدائي الحالي في البنك:";
    const raw = prompt(promptMsg);
    if (raw === null) return;
    const amount = Number(raw);
    if (Number.isNaN(amount)) {
      alert("قيمة غير صالحة.");
      return;
    }
    try {
      const res = await Api.initBankBalance(amount, isReset);
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      renderFinanceDashboard();
    } catch (err) {
      alert(`تعذر تعيين الرصيد: ${err.message}`);
    }
  }

  async function handleTransfer(direction) {
    if (financeData.bankBalance === null || financeData.bankBalance === undefined) {
      alert("يجب تعيين الرصيد الابتدائي للبنك أولًا.");
      return;
    }
    const label = direction === "toPocket" ? "من البنك إلى الجيب" : "من الجيب إلى البنك";
    const raw = prompt(`أدخل المبلغ المراد تحويله ${label}:`);
    if (raw === null) return;
    const amount = Number(raw);
    if (Number.isNaN(amount) || amount <= 0) {
      alert("قيمة غير صالحة.");
      return;
    }
    try {
      const res = await Api.transferFunds(direction, amount);
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      renderFinanceDashboard();
    } catch (err) {
      alert(`تعذر التحويل: ${err.message}`);
    }
  }

  /* ---------- dynamic category fields (built-in + custom) ---------- */

  function renderFieldGrid(containerId, fields, scope) {
    const container = document.getElementById(containerId);
    container.innerHTML = fields
      .map((f) => {
        const removeBtn = f.custom
          ? `<button type="button" class="field-remove-btn" data-scope="${scope}" data-key="${f.key}" title="حذف البند">×</button>`
          : "";
        return `
        <div class="field">
          <label for="${f.id}">${escapeHTML(f.label)}${removeBtn}</label>
          <input type="number" id="${f.id}" min="0" step="0.01" placeholder="0">
        </div>`;
      })
      .join("");

    container.querySelectorAll(".field-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleRemoveCategory(btn.dataset.scope, btn.dataset.key));
    });
  }

  function renderDailyFieldGrid() {
    renderFieldGrid("dailyExpenseGrid", allDailyFields(), "daily");
  }

  function renderMonthlyFieldGrid() {
    renderFieldGrid("monthlyExpenseGrid", allMonthlyFields(), "monthly");
  }

  async function handleAddCategory(scope) {
    const label = prompt(
      scope === "daily"
        ? "اسم البند اليومي الجديد (مثال: لوازم أطفال):"
        : "اسم البند الشهري الجديد (مثال: علاج):"
    );
    if (!label || !label.trim()) return;

    let income = false;
    if (scope === "monthly") {
      income = confirm("هل هذا البند دخل (يُضاف للرصيد) وليس مصروف (يُخصم)؟\nموافق = دخل، إلغاء = مصروف.");
    }

    try {
      const res = await Api.addFinanceCategory(scope, label.trim(), income);
      financeData.customCategories = res.customCategories;
      if (scope === "daily") {
        renderDailyFieldGrid();
        loadDailyExpenseFields();
      } else {
        renderMonthlyFieldGrid();
        renderFinanceMonthUI();
      }
    } catch (err) {
      alert(`تعذر إضافة البند: ${err.message}`);
    }
  }

  async function handleRemoveCategory(scope, key) {
    const field = (scope === "daily" ? allDailyFields() : allMonthlyFields()).find(
      (f) => f.key === key
    );
    const label = field ? field.label : key;
    if (!confirm(`حذف بند "${label}"؟ القيم المحفوظة سابقًا تحته تبقى في السجل، لكنه لن يظهر بعد الآن.`)) {
      return;
    }
    try {
      const res = await Api.deleteFinanceCategory(scope, key);
      financeData.customCategories = res.customCategories;
      if (scope === "daily") {
        renderDailyFieldGrid();
        loadDailyExpenseFields();
      } else {
        renderMonthlyFieldGrid();
        renderFinanceMonthUI();
      }
      renderFinanceDashboard();
    } catch (err) {
      alert(`تعذر حذف البند: ${err.message}`);
    }
  }

  /* ---------- daily expenses ---------- */

  function loadDailyExpenseFields() {
    const entry = financeData.dailyExpenses[currentFinDate] || {};
    allDailyFields().forEach((f) => setVal(f.id, entry[f.key]));
    const statusEl = document.getElementById("finDailyStatus");
    statusEl.textContent = entry.savedAt
      ? `آخر حفظ: ${new Date(entry.savedAt).toLocaleString("ar")}`
      : "لم يُحفظ بعد";
    statusEl.className = "save-status";
    const historyEl = document.getElementById("finDailyHistory");
    if (historyEl) historyEl.innerHTML = renderHistoryList(entry.history);
  }

  async function saveDailyExpenses() {
    if (financeData.bankBalance === null || financeData.bankBalance === undefined) {
      alert("يجب تعيين الرصيد الابتدائي للبنك أولًا.");
      return;
    }
    const fields = allDailyFields();
    const expenses = {};
    fields.forEach((f) => (expenses[f.key] = getNum(f.id) || 0));

    const statusEl = document.getElementById("finDailyStatus");
    statusEl.textContent = "جارٍ الحفظ…";
    statusEl.className = "save-status";
    try {
      const res = await Api.saveDailyExpenses(currentFinDate, expenses);
      const prevHistory = financeData.dailyExpenses[currentFinDate]?.history || [];
      financeData.dailyExpenses[currentFinDate] = {
        ...expenses,
        savedAt: new Date().toISOString(),
        history: prevHistory.concat(res.changes || []),
      };
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      statusEl.textContent = `✓ تم الحفظ — ${new Date().toLocaleTimeString("ar")}`;
      statusEl.className = "save-status ok";
      renderFinanceDashboard();
      loadDailyExpenseFields();
    } catch (err) {
      statusEl.textContent = `تعذر الحفظ: ${err.message}`;
      statusEl.className = "save-status err";
    }
  }

  /* ---------- monthly expenses ---------- */

  function renderFinanceMonthUI() {
    document.getElementById("finMonthLabel").textContent = monthLabel(currentFinMonth);
    const entry = financeData.monthlyExpenses[currentFinMonth] || {};
    allMonthlyFields().forEach((f) => setVal(f.id, entry[f.key]));
    const statusEl = document.getElementById("finMonthlyStatus");
    statusEl.textContent = entry.savedAt
      ? `آخر حفظ: ${new Date(entry.savedAt).toLocaleString("ar")}`
      : "لم يُحفظ بعد";
    statusEl.className = "save-status";
    const historyEl = document.getElementById("finMonthlyHistory");
    if (historyEl) historyEl.innerHTML = renderHistoryList(entry.history);
  }

  async function saveMonthlyExpenses() {
    if (financeData.bankBalance === null || financeData.bankBalance === undefined) {
      alert("يجب تعيين الرصيد الابتدائي للبنك أولًا.");
      return;
    }
    const fields = allMonthlyFields();
    const entry = {};
    fields.forEach((f) => (entry[f.key] = getNum(f.id) || 0));

    const statusEl = document.getElementById("finMonthlyStatus");
    statusEl.textContent = "جارٍ الحفظ…";
    statusEl.className = "save-status";
    try {
      const res = await Api.saveMonthlyExpenses(currentFinMonth, entry);
      const prevHistory = financeData.monthlyExpenses[currentFinMonth]?.history || [];
      financeData.monthlyExpenses[currentFinMonth] = {
        ...entry,
        savedAt: new Date().toISOString(),
        history: prevHistory.concat(res.changes || []),
      };
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      statusEl.textContent = `✓ تم الحفظ — ${new Date().toLocaleTimeString("ar")}`;
      statusEl.className = "save-status ok";
      renderFinanceDashboard();
      renderFinanceMonthUI();
    } catch (err) {
      statusEl.textContent = `تعذر الحفظ: ${err.message}`;
      statusEl.className = "save-status err";
    }
  }

  /* ---------- extra income transactions ---------- */

  function incomeTransactionsInRange(startDate, endDate) {
    return Object.values(financeData.incomeTransactions || {})
      .filter((t) => t.date >= startDate && t.date <= endDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function renderIncomeList() {
    const all = Object.values(financeData.incomeTransactions || {}).sort((a, b) =>
      a.date < b.date ? 1 : -1
    );
    const container = document.getElementById("incomeList");
    if (all.length === 0) {
      container.innerHTML = '<div class="empty-hint">لا توجد إيرادات إضافية مسجّلة بعد.</div>';
      return;
    }
    container.innerHTML = all
      .map(
        (t) => `
        <div class="income-row-wrap">
          <div class="income-row">
            <span class="income-row-date">${t.date}</span>
            <span class="income-row-reason">${escapeHTML(t.reason || "—")}</span>
            <span class="income-row-amount">${formatCurrency(t.amount)}</span>
            <button type="button" class="income-row-edit" data-id="${t.id}" title="تعديل">✎</button>
            <button type="button" class="income-row-delete" data-id="${t.id}" title="حذف">×</button>
          </div>
          ${renderHistoryList(t.history)}
        </div>`
      )
      .join("");

    container.querySelectorAll(".income-row-delete").forEach((btn) => {
      btn.addEventListener("click", () => handleDeleteIncome(btn.dataset.id));
    });
    container.querySelectorAll(".income-row-edit").forEach((btn) => {
      btn.addEventListener("click", () => handleEditIncome(btn.dataset.id));
    });
  }

  async function handleAddIncome() {
    if (financeData.bankBalance === null || financeData.bankBalance === undefined) {
      alert("يجب تعيين الرصيد الابتدائي للبنك أولًا.");
      return;
    }
    const amount = getNum("incomeAmount");
    const date = getVal("incomeDate");
    const reason = getVal("incomeReason").trim();

    if (!amount || amount <= 0) {
      alert("أدخل مبلغًا صحيحًا أكبر من صفر.");
      return;
    }
    if (!date) {
      alert("اختر تاريخًا.");
      return;
    }

    const statusEl = document.getElementById("incomeStatus");
    statusEl.textContent = "جارٍ الحفظ…";
    statusEl.className = "save-status";
    try {
      const res = await Api.addIncomeTransaction(date, amount, reason);
      financeData.incomeTransactions[res.transaction.id] = res.transaction;
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      renderIncomeList();
      renderFinanceDashboard();
      setVal("incomeAmount", "");
      setVal("incomeReason", "");
      statusEl.textContent = "✓ تمت الإضافة";
      statusEl.className = "save-status ok";
    } catch (err) {
      statusEl.textContent = `تعذر الحفظ: ${err.message}`;
      statusEl.className = "save-status err";
    }
  }

  async function handleEditIncome(id) {
    const t = financeData.incomeTransactions[id];
    if (!t) return;

    const rawAmount = prompt("المبلغ الجديد:", t.amount);
    if (rawAmount === null) return;
    const amount = Number(rawAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      alert("قيمة غير صالحة.");
      return;
    }

    const rawDate = prompt("التاريخ (YYYY-MM-DD):", t.date);
    if (rawDate === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      alert("تاريخ غير صالح.");
      return;
    }

    const rawReason = prompt("السبب:", t.reason || "");
    if (rawReason === null) return;

    try {
      const res = await Api.updateIncomeTransaction(id, rawDate, amount, rawReason.trim());
      financeData.incomeTransactions[id] = res.transaction;
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      renderIncomeList();
      renderFinanceDashboard();
    } catch (err) {
      alert(`تعذر التعديل: ${err.message}`);
    }
  }

  async function handleDeleteIncome(id) {
    const t = financeData.incomeTransactions[id];
    if (!t) return;
    if (!confirm(`حذف إيراد "${t.reason || "بدون سبب"}" بمبلغ ${formatCurrency(t.amount)}؟`)) return;
    try {
      const res = await Api.deleteIncomeTransaction(id);
      delete financeData.incomeTransactions[id];
      financeData.bankBalance = res.bankBalance;
      financeData.pocketBalance = res.pocketBalance;
      updateBalanceStrips();
      renderIncomeList();
      renderFinanceDashboard();
    } catch (err) {
      alert(`تعذر الحذف: ${err.message}`);
    }
  }

  /* ---------- dashboard / table / export ---------- */

  function renderFinanceDashboard() {
    document.getElementById("finWeekLabel").textContent = weekRangeLabel(currentFinWeekStart);
    const reportWeekLabelEl = document.getElementById("reportWeekRangeLabel");
    if (reportWeekLabelEl) reportWeekLabelEl.textContent = weekRangeLabel(currentFinWeekStart);

    const dailyFields = allDailyFields();
    const dates = weekDates(currentFinWeekStart);
    const entries = dates.map((d) => financeData.dailyExpenses[d] || null);

    const totals = {};
    dailyFields.forEach((f) => (totals[f.key] = 0));
    let weekTotal = 0;
    entries.forEach((e) => {
      if (!e) return;
      dailyFields.forEach((f) => {
        const v = Number(e[f.key]) || 0;
        totals[f.key] += v;
        weekTotal += v;
      });
    });

    const weekIncomeTotal = incomeTransactionsInRange(dates[0], dates[dates.length - 1])
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const monthlyFields = allMonthlyFields();
    const monthEntry = financeData.monthlyExpenses[currentFinMonth] || {};
    const monthExpenseTotal = monthlyFields
      .filter((f) => !f.income)
      .reduce((s, f) => s + (Number(monthEntry[f.key]) || 0), 0);

    const stats = [
      { label: "مصاريف الأسبوع المعروض", value: formatCurrency(weekTotal) },
      { label: "إيرادات الأسبوع المعروض", value: formatCurrency(weekIncomeTotal) },
      { label: "مصاريف الشهر (فواتير)", value: formatCurrency(monthExpenseTotal) },
    ];

    document.getElementById("financeStatGrid").innerHTML = stats
      .map(
        (s) => `
        <div class="stat-card">
          <div class="stat-label">${s.label}</div>
          <div class="stat-value">${s.value}</div>
        </div>`
      )
      .join("");

    document.getElementById("financeBreakdown").innerHTML = dailyFields.map((f) => `
      <div class="fin-breakdown-row">
        <span class="fin-breakdown-name">${escapeHTML(f.label)}</span>
        <span class="fin-breakdown-value">${formatCurrency(totals[f.key])}</span>
      </div>`).join("");

    const headerCells = dates
      .map((date) => {
        const d = parseDate(date);
        return `<th>${WEEKDAY_NAMES_AR[d.getDay()]}</th>`;
      })
      .join("");

    const bodyRows = dailyFields.map((f) => {
      const cells = dates
        .map((date) => {
          const e = financeData.dailyExpenses[date];
          const v = e ? Number(e[f.key]) || 0 : 0;
          return `<td>${v ? formatCurrency(v) : "—"}</td>`;
        })
        .join("");
      return `<tr><td>${escapeHTML(f.label)}</td>${cells}</tr>`;
    }).join("");

    document.getElementById("financeWeekTable").innerHTML =
      `<thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
  }

  function renderFinancePage() {
    updateBalanceStrips();
    renderDailyFieldGrid();
    loadDailyExpenseFields();
    renderMonthlyFieldGrid();
    renderFinanceMonthUI();
    renderIncomeList();
    renderReportMonthLabel();
    renderFinanceDashboard();
  }

  function exportFinanceWeekReport() {
    const dailyFields = allDailyFields();
    const dates = weekDates(currentFinWeekStart);
    const entries = dates.map((d) => financeData.dailyExpenses[d] || null);

    const totals = {};
    dailyFields.forEach((f) => (totals[f.key] = 0));
    let weekTotal = 0;
    entries.forEach((e) => {
      if (!e) return;
      dailyFields.forEach((f) => {
        const v = Number(e[f.key]) || 0;
        totals[f.key] += v;
        weekTotal += v;
      });
    });

    const weekIncome = incomeTransactionsInRange(dates[0], dates[dates.length - 1]);
    const weekIncomeTotal = weekIncome.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const expenseLines = dailyFields
      .map((f) => `- ${f.label}: ${formatCurrency(totals[f.key])}`)
      .join("\n");

    const incomeLines = weekIncome.length
      ? weekIncome.map((t) => `- ${t.date} — ${t.reason || "بدون سبب"}: ${formatCurrency(t.amount)}`).join("\n")
      : "لا توجد إيرادات إضافية هذا الأسبوع.";

    const summary = `
تقرير مصاريف الأسبوع: ${weekRangeLabel(currentFinWeekStart)}
=================================================

إجمالي مصاريف الأسبوع: ${formatCurrency(weekTotal)}
إجمالي الإيرادات الإضافية: ${formatCurrency(weekIncomeTotal)}
صافي الأسبوع: ${formatCurrency(weekIncomeTotal - weekTotal)}

المصاريف حسب البند:
${expenseLines}

الإيرادات الإضافية:
${incomeLines}

رصيد البنك الحالي: ${
      financeData.bankBalance === null || financeData.bankBalance === undefined
        ? "غير معيّن"
        : formatCurrency(financeData.bankBalance)
    }
`.trim();

    const bundle = {
      summary,
      data: {
        weekStart: currentFinWeekStart,
        weekRange: weekRangeLabel(currentFinWeekStart),
        dailyExpenses: Object.fromEntries(dates.map((d, i) => [d, entries[i]])),
        totals,
        weekTotal,
        incomeTransactions: weekIncome,
        weekIncomeTotal,
        bankBalance: financeData.bankBalance,
      },
    };

    downloadFile(
      JSON.stringify(bundle, null, 2),
      `finance_week_report_${currentFinWeekStart}.json`,
      "application/json"
    );
  }

  function exportFinanceWeekReportExcel() {
    const dailyFields = allDailyFields();
    const dates = weekDates(currentFinWeekStart);
    const entries = dates.map((d) => financeData.dailyExpenses[d] || null);

    // Sheet 1: Summary
    const totals = {};
    dailyFields.forEach((f) => (totals[f.key] = 0));
    let weekTotal = 0;
    entries.forEach((e) => {
      if (!e) return;
      dailyFields.forEach((f) => {
        totals[f.key] += Number(e[f.key]) || 0;
      });
    });
    const weekIncome = incomeTransactionsInRange(dates[0], dates[dates.length - 1]);
    const weekIncomeTotal = weekIncome.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // Daily expenses sheet: rows = dates, cols = categories, with SUM row/col via formulas.
    const dailyHeader = ["التاريخ", ...dailyFields.map((f) => f.label), "الإجمالي"];
    const dailyRows = dates.map((date, i) => {
      const e = entries[i] || {};
      const vals = dailyFields.map((f) => Number(e[f.key]) || 0);
      return [date, ...vals];
    });
    // Append a real SUM formula per row (last column) and a totals row (per column).
    const colCount = dailyFields.length;
    const dailyAoa = [dailyHeader];
    dailyRows.forEach((row, i) => {
      const excelRow = i + 2; // 1-based, +1 for header
      const rowValues = row.slice(1);
      const rowWithFormula = [row[0], ...rowValues, { f: `SUM(B${excelRow}:${XLSX.utils.encode_col(colCount)}${excelRow})` }];
      dailyAoa.push(rowWithFormula);
    });
    const firstDataRow = 2;
    const lastDataRow = 1 + dates.length;
    const totalsRow = ["الإجمالي"];
    for (let c = 0; c < colCount; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      totalsRow.push({ f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` });
    }
    totalsRow.push({ f: `SUM(B${lastDataRow + 1}:${XLSX.utils.encode_col(colCount)}${lastDataRow + 1})` });
    dailyAoa.push(totalsRow);

    // Income sheet
    const incomeHeader = ["التاريخ", "السبب", "المبلغ"];
    const incomeRows = weekIncome.map((t) => [t.date, t.reason || "—", Number(t.amount) || 0]);
    const incomeAoa = [incomeHeader, ...incomeRows];
    if (incomeRows.length) {
      const lastRow = incomeRows.length + 1;
      incomeAoa.push(["الإجمالي", "", { f: `SUM(C2:C${lastRow})` }]);
    }

    // History sheet (daily expense edits only, this week's dates)
    const historyHeader = ["التاريخ", "البند", "من", "إلى", "وقت التعديل"];
    const historyRows = [];
    dates.forEach((date, i) => {
      const e = entries[i];
      if (e && Array.isArray(e.history)) {
        e.history.forEach((h) => {
          historyRows.push([date, h.label || h.field, h.old, h.new, h.at ? new Date(h.at).toLocaleString("ar") : ""]);
        });
      }
    });
    weekIncome.forEach((t) => {
      if (Array.isArray(t.history)) {
        t.history.forEach((h) => {
          historyRows.push([`دخل: ${t.date}`, h.label || h.field, h.old, h.new, h.at ? new Date(h.at).toLocaleString("ar") : ""]);
        });
      }
    });
    const historyAoa = [historyHeader, ...historyRows];

    const summaryAoa = [
      ["تقرير مصاريف الأسبوع", weekRangeLabel(currentFinWeekStart)],
      [],
      ["إجمالي مصاريف الأسبوع", { f: `'المصاريف اليومية'!${XLSX.utils.encode_col(colCount + 1)}${lastDataRow + 1}` }],
      ["إجمالي الإيرادات", weekIncomeTotal],
      ["صافي الأسبوع", weekIncomeTotal - weekTotal],
      ["رصيد البنك الحالي", financeData.bankBalance ?? "غير معيّن"],
      ["رصيد الجيب الحالي", financeData.pocketBalance || 0],
    ];

    downloadXlsx(
      [
        { name: "الملخص", rows: summaryAoa },
        { name: "المصاريف اليومية", rows: dailyAoa },
        { name: "الإيرادات", rows: incomeAoa },
        { name: "سجل التعديلات", rows: historyAoa },
      ],
      `finance_week_report_${currentFinWeekStart}.xlsx`
    );
  }

  // Monthly report: every day from the 1st to the last day of the
  // selected month (accumulated daily expenses), plus that month's
  // fixed monthly items (bills + salary) and every extra income
  // transaction dated within the month — all in one file.
  function exportFinanceMonthReport() {
    const dailyFields = allDailyFields();
    const [y, m] = currentReportMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthDates = Array.from({ length: daysInMonth }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return `${currentReportMonth}-${day}`;
    });

    const dailyTotals = {};
    dailyFields.forEach((f) => (dailyTotals[f.key] = 0));
    let dailyGrandTotal = 0;
    const dailyEntriesForMonth = {};
    monthDates.forEach((date) => {
      const e = financeData.dailyExpenses[date];
      if (e) dailyEntriesForMonth[date] = e;
      dailyFields.forEach((f) => {
        const v = e ? Number(e[f.key]) || 0 : 0;
        dailyTotals[f.key] += v;
        dailyGrandTotal += v;
      });
    });

    const monthlyFields = allMonthlyFields();
    const monthEntry = financeData.monthlyExpenses[currentReportMonth] || {};
    const monthlyExpenseTotal = monthlyFields
      .filter((f) => !f.income)
      .reduce((s, f) => s + (Number(monthEntry[f.key]) || 0), 0);
    const monthlyIncomeFixed = monthlyFields
      .filter((f) => f.income)
      .reduce((s, f) => s + (Number(monthEntry[f.key]) || 0), 0);

    const extraIncome = incomeTransactionsInRange(monthDates[0], monthDates[monthDates.length - 1]);
    const extraIncomeTotal = extraIncome.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const totalExpenses = dailyGrandTotal + monthlyExpenseTotal;
    const totalIncome = monthlyIncomeFixed + extraIncomeTotal;

    const dailyLines = dailyFields
      .map((f) => `- ${f.label}: ${formatCurrency(dailyTotals[f.key])}`)
      .join("\n");

    const monthlyLines = monthlyFields
      .map((f) => `- ${f.label}${f.income ? " (دخل)" : ""}: ${formatCurrency(monthEntry[f.key] || 0)}`)
      .join("\n");

    const incomeLines = extraIncome.length
      ? extraIncome.map((t) => `- ${t.date} — ${t.reason || "بدون سبب"}: ${formatCurrency(t.amount)}`).join("\n")
      : "لا توجد إيرادات إضافية هذا الشهر.";

    const summary = `
تقرير الشهر: ${monthLabel(currentReportMonth)} (${currentReportMonth}-01 → ${monthDates[monthDates.length - 1]})
=================================================

إجمالي المصاريف اليومية المتراكمة: ${formatCurrency(dailyGrandTotal)}
إجمالي المصاريف الشهرية (فواتير): ${formatCurrency(monthlyExpenseTotal)}
إجمالي المصاريف: ${formatCurrency(totalExpenses)}

دخل الراتب/البنود الشهرية: ${formatCurrency(monthlyIncomeFixed)}
إجمالي الإيرادات الإضافية: ${formatCurrency(extraIncomeTotal)}
إجمالي الدخل: ${formatCurrency(totalIncome)}

صافي الشهر: ${formatCurrency(totalIncome - totalExpenses)}

المصاريف اليومية حسب البند (متراكمة لكل الشهر):
${dailyLines}

المصاريف والدخل الشهري الثابت:
${monthlyLines}

الإيرادات الإضافية:
${incomeLines}

رصيد البنك الحالي: ${
      financeData.bankBalance === null || financeData.bankBalance === undefined
        ? "غير معيّن"
        : formatCurrency(financeData.bankBalance)
    }
`.trim();

    const bundle = {
      summary,
      data: {
        month: currentReportMonth,
        monthLabel: monthLabel(currentReportMonth),
        dateRange: { from: monthDates[0], to: monthDates[monthDates.length - 1] },
        dailyExpenses: dailyEntriesForMonth,
        dailyTotals,
        dailyGrandTotal,
        monthlyExpenses: monthEntry,
        monthlyExpenseTotal,
        monthlyIncomeFixed,
        incomeTransactions: extraIncome,
        extraIncomeTotal,
        totalExpenses,
        totalIncome,
        netForMonth: totalIncome - totalExpenses,
        bankBalance: financeData.bankBalance,
      },
    };

    downloadFile(
      JSON.stringify(bundle, null, 2),
      `finance_month_report_${currentReportMonth}.json`,
      "application/json"
    );
  }

  function exportFinanceMonthReportExcel() {
    const dailyFields = allDailyFields();
    const monthlyFields = allMonthlyFields();
    const [y, m] = currentReportMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthDates = Array.from({ length: daysInMonth }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return `${currentReportMonth}-${day}`;
    });

    // Daily expenses sheet
    const colCount = dailyFields.length;
    const dailyHeader = ["التاريخ", ...dailyFields.map((f) => f.label), "الإجمالي"];
    const dailyAoa = [dailyHeader];
    monthDates.forEach((date, i) => {
      const e = financeData.dailyExpenses[date] || {};
      const vals = dailyFields.map((f) => Number(e[f.key]) || 0);
      const excelRow = i + 2;
      dailyAoa.push([date, ...vals, { f: `SUM(B${excelRow}:${XLSX.utils.encode_col(colCount)}${excelRow})` }]);
    });
    const firstDataRow = 2;
    const lastDataRow = 1 + monthDates.length;
    const dailyTotalsRow = ["الإجمالي"];
    for (let c = 0; c < colCount; c++) {
      const colLetter = XLSX.utils.encode_col(c + 1);
      dailyTotalsRow.push({ f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` });
    }
    dailyTotalsRow.push({ f: `SUM(B${lastDataRow + 1}:${XLSX.utils.encode_col(colCount)}${lastDataRow + 1})` });
    dailyAoa.push(dailyTotalsRow);
    const dailyGrandTotalCell = `'المصاريف اليومية'!${XLSX.utils.encode_col(colCount + 1)}${lastDataRow + 1}`;

    // Monthly fixed items sheet
    const monthEntry = financeData.monthlyExpenses[currentReportMonth] || {};
    const monthlyAoa = [["البند", "النوع", "المبلغ"]];
    monthlyFields.forEach((f) => {
      monthlyAoa.push([f.label, f.income ? "دخل" : "مصروف", Number(monthEntry[f.key]) || 0]);
    });
    const monthlyExpenseRowsIdx = monthlyFields
      .map((f, i) => (!f.income ? i + 2 : null))
      .filter((x) => x !== null);
    const monthlyIncomeRowsIdx = monthlyFields
      .map((f, i) => (f.income ? i + 2 : null))
      .filter((x) => x !== null);
    // Written as explicit cell-reference SUM since rows may be non-contiguous.
    const sumRefs = (idxArr) => (idxArr.length ? idxArr.map((r) => `C${r}`).join(",") : "0");
    monthlyAoa.push([]);
    monthlyAoa.push(["إجمالي المصروفات الشهرية", "", { f: `SUM(${sumRefs(monthlyExpenseRowsIdx)})` }]);
    monthlyAoa.push(["إجمالي الدخل الشهري الثابت", "", { f: `SUM(${sumRefs(monthlyIncomeRowsIdx)})` }]);

    // Extra income sheet
    const extraIncome = incomeTransactionsInRange(monthDates[0], monthDates[monthDates.length - 1]);
    const incomeAoa = [["التاريخ", "السبب", "المبلغ"]];
    extraIncome.forEach((t) => incomeAoa.push([t.date, t.reason || "—", Number(t.amount) || 0]));
    if (extraIncome.length) {
      const lastRow = extraIncome.length + 1;
      incomeAoa.push(["الإجمالي", "", { f: `SUM(C2:C${lastRow})` }]);
    }

    // History sheet
    const historyAoa = [["التاريخ", "البند", "من", "إلى", "وقت التعديل"]];
    monthDates.forEach((date) => {
      const e = financeData.dailyExpenses[date];
      if (e && Array.isArray(e.history)) {
        e.history.forEach((h) => {
          historyAoa.push([date, h.label || h.field, h.old, h.new, h.at ? new Date(h.at).toLocaleString("ar") : ""]);
        });
      }
    });
    if (Array.isArray(monthEntry.history)) {
      monthEntry.history.forEach((h) => {
        historyAoa.push([`شهري: ${currentReportMonth}`, h.label || h.field, h.old, h.new, h.at ? new Date(h.at).toLocaleString("ar") : ""]);
      });
    }
    extraIncome.forEach((t) => {
      if (Array.isArray(t.history)) {
        t.history.forEach((h) => {
          historyAoa.push([`دخل: ${t.date}`, h.label || h.field, h.old, h.new, h.at ? new Date(h.at).toLocaleString("ar") : ""]);
        });
      }
    });

    const extraIncomeTotal = extraIncome.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const monthlyExpenseTotal = monthlyFields.filter((f) => !f.income).reduce((s, f) => s + (Number(monthEntry[f.key]) || 0), 0);
    const monthlyIncomeFixed = monthlyFields.filter((f) => f.income).reduce((s, f) => s + (Number(monthEntry[f.key]) || 0), 0);

    const summaryAoa = [
      ["تقرير الشهر", monthLabel(currentReportMonth)],
      [],
      ["إجمالي المصاريف اليومية المتراكمة", { f: dailyGrandTotalCell }],
      ["إجمالي المصاريف الشهرية (فواتير)", monthlyExpenseTotal],
      ["دخل الراتب/البنود الشهرية", monthlyIncomeFixed],
      ["إجمالي الإيرادات الإضافية", extraIncomeTotal],
      ["رصيد البنك الحالي", financeData.bankBalance ?? "غير معيّن"],
      ["رصيد الجيب الحالي", financeData.pocketBalance || 0],
    ];

    downloadXlsx(
      [
        { name: "الملخص", rows: summaryAoa },
        { name: "المصاريف اليومية", rows: dailyAoa },
        { name: "المصاريف الشهرية الثابتة", rows: monthlyAoa },
        { name: "الإيرادات الإضافية", rows: incomeAoa },
        { name: "سجل التعديلات", rows: historyAoa },
      ],
      `finance_month_report_${currentReportMonth}.xlsx`
    );
  }

  /* ============================================================
     UTIL
  ============================================================ */

  // Renders a compact "what changed, from -> to, when" list for any
  // entry that carries a `history` array (daily/monthly expense entries,
  // income transactions). Returns "" when there's nothing to show.
  function renderHistoryList(history) {
    if (!Array.isArray(history) || history.length === 0) return "";
    const rows = history
      .slice()
      .reverse()
      .map((h) => {
        const when = h.at ? new Date(h.at).toLocaleString("ar") : "";
        return `<div class="history-row">
          <span class="history-field">${escapeHTML(h.label || h.field)}</span>
          <span class="history-change">${escapeHTML(String(h.old))} ← ${escapeHTML(String(h.new))}</span>
          <span class="history-at">${escapeHTML(when)}</span>
        </div>`;
      })
      .join("");
    return `<div class="history-list"><div class="history-title">سجل التعديلات</div>${rows}</div>`;
  }

  function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  /* ============================================================
     INIT
  ============================================================ */

  async function init() {
    initTheme();
    initNav();
    initDateBar();
    initMood();
    initPlanPage();
    initDashboardPage();
    initFinancePage();

    document.getElementById("saveDayBtn").addEventListener("click", saveDailyEntry);

    await checkConnection();

    try {
      const [dataRes, plansRes, reviewsRes, financeRes] = await Promise.all([
        Api.getData(),
        Api.getPlans(),
        Api.getReviews(),
        Api.getFinance(),
      ]);
      allEntries = dataRes.entries || {};
      allPlans = plansRes.plans || [];
      allReviews = reviewsRes || {};
      financeData = financeRes || { bankBalance: null, pocketBalance: 0, dailyExpenses: {}, monthlyExpenses: {}, customCategories: { daily: [], monthly: [] }, incomeTransactions: {} };
      if (financeData.pocketBalance === undefined || financeData.pocketBalance === null) financeData.pocketBalance = 0;
      if (!financeData.incomeTransactions) financeData.incomeTransactions = {};
      if (!financeData.customCategories) financeData.customCategories = { daily: [], monthly: [] };
    } catch (err) {
      console.error("Initial load failed", err);
    }

    loadDailyEntry();
    renderFinancePage();
  }

  return { init };

})();

document.addEventListener("DOMContentLoaded", App.init);