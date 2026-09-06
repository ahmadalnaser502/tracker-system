# =================================================================
# Dockerfile — Personal Tracker Backend
# -----------------------------------------------------------------
# مبدأ التصميم: الـ image نفسه stateless بالكامل — كود + runtime بس.
# أي بيانات حقيقية (Tracker/) بتيجي من الـ host عبر volume وقت
# التشغيل (docker run -v ...)، مش موجودة هون إطلاقًا.
# =================================================================

# ---- القاعدة ----
FROM node:20-slim

# ---- مجلد العمل جوا الـ container ----
WORKDIR /app

# ---- نسخ ملفات الـ dependencies أولًا فقط (Docker layer caching) ----
COPY package*.json ./

# ---- تثبيت الـ dependencies (production فقط) ----
RUN npm install --omit=dev

# ---- نسخ باقي الكود ----
COPY . .

# ---- توثيق البورت ----
EXPOSE 8080

# ---- أمر التشغيل ----
CMD ["node", "server.js"]