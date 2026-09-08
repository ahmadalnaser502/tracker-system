# Personal Development & Life Tracking System

نظام تتبع شخصي (عبادات، رياضة، تعلم، مزاج، مالية) — Node.js + Express + JSON files بالباك إند، HTML/CSS/JS بالفرونت إند. يُستخدم بالتوازي كمنصة تعلّم DevOps تدريجية.

## البنية


## التشغيل
راجع `SETUP.md` لتفاصيل الإعداد الكاملة (PM2، Docker، متغيرات البيئة).


## Monitoring

- `/api/health` — فحص صحة بسيط
- `/metrics` — Prometheus metrics (مضافة عبر `prom-client`، راجع commit `8ce3894`)
- **Prometheus** — يجمع المقاييس من `backend:8080/metrics` كل 15 ثانية، متاح على `localhost:9090` (راجع `prometheus.yml` و commit `5849324`)
- **Grafana** — طبقة عرض، متاحة على `localhost:3001`. الإعداد الحالي **يدوي بالكامل** (data source + dashboard مُعرَّفين من واجهة Grafana نفسها، وليسا ملفات بالمشروع):
  - Data source: Prometheus على `http://prometheus:9090`
  - Dashboard: "Tracker Backend — Overview" — 10 panels موزعة على 3 صفوف (At a Glance / Traffic Over Time / Process Health)
  - **قيد مهم:** بما إنه الإعداد يدوي، فهو محفوظ فقط داخل `grafana-data` volume على هذا الجهاز — غير متتبَّع بـ Git، ولن يُعاد إنشاؤه تلقائيًا على جهاز آخر أو لو حُذف الـ volume. الانتقال لـ provisioning (ملفات YAML + JSON قابلة للتتبع بـ Git) مؤجَّل عمدًا حتى يستقر عدد الـ dashboards الفعلية.