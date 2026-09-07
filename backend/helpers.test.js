const { sumDailyEntry } = require("./helpers.js");

describe("sumDailyEntry", () => {
  test("مجموع 20 + 15 يساوي 35", () => {
    const entry = { groceries: 20, car: 15 };
    const keys = ["groceries", "car"];
    expect(sumDailyEntry(entry, keys)).toBe(35);
  });

  test("entry فاضي (null) يرجع صفر", () => {
    const keys = ["groceries", "car"];
    expect(sumDailyEntry(null, keys)).toBe(0);
  });

  test("مفتاح غير موجود يُحسب كصفر، لا يسبب خطأ", () => {
    const entry = { groceries: 10 }; // car غير موجود إطلاقًا
    const keys = ["groceries", "car"];
    expect(sumDailyEntry(entry, keys)).toBe(10);
  });

  test("قيمة نصية غير رقمية تُحسب كصفر، لا تكسر الجمع", () => {
    const entry = { groceries: "abc", car: 15 };
    const keys = ["groceries", "car"];
    expect(sumDailyEntry(entry, keys)).toBe(15);
  });
});