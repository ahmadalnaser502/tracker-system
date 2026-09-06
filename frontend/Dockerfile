# =================================================================
# Dockerfile — Personal Tracker Frontend
# -----------------------------------------------------------------
# nginx يخدم الملفات الستاتيكية + يمرّر طلبات /api/ لحاوية backend
# =================================================================

FROM nginx:alpine

# نحذف الإعداد الافتراضي لـ nginx (بيخدم صفحة "Welcome to nginx")
RUN rm /etc/nginx/conf.d/default.conf

# ننسخ إعدادنا الخاص بدله
COPY nginx.conf /etc/nginx/conf.d/default.conf

# ننسخ ملفات الواجهة لمكان nginx القياسي لخدمة الملفات الستاتيكية
COPY . /usr/share/nginx/html

EXPOSE 80