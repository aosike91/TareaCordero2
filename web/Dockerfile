FROM nginx:1.27-alpine
COPY index.html styles.css app.js config.js /usr/share/nginx/html/
# Los scripts en /docker-entrypoint.d/ se ejecutan antes de iniciar nginx
COPY docker-entrypoint.sh /docker-entrypoint.d/40-generar-config.sh
RUN chmod +x /docker-entrypoint.d/40-generar-config.sh
EXPOSE 80
