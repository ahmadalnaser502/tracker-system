# Personal Development & Life Tracking System

نظام تتبع شخصي (عبادات، رياضة، تعلم، مزاج، مالية) — Node.js + Express + JSON files بالباك إند، HTML/CSS/JS بالفرونت إند. يُستخدم بالتوازي كمنصة تعلّم DevOps تدريجية.

## البنية


## التشغيل
راجع `SETUP.md` لتفاصيل الإعداد الكاملة (PM2، Docker، متغيرات البيئة).

## Monitoring
- `/api/health` — فحص صحة بسيط
- `/metrics` — Prometheus metrics (مضافة عبر `prom-client`، راجع commit `8ce3894`)

> **ملاحظة تاريخية:** commit `8ce3894` بعنوان "add readme file" يحتوي فعليًا أيضًا على كامل إعداد Prometheus middleware في `backend/server.js` (خطأ توثيق أثناء العمل — لم يُصحَّح تفاديًا لإعادة كتابة تاريخ فرع `main` بعد الدفع). الكود نفسه تم مراجعته والتحقق منه بالكامل قبل الدفع.