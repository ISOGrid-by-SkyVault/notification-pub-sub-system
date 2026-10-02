# Static inbox frontend served by nginx, running as a non-root user on port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Where /api and the SSE stream are proxied to. Override it when the API
# service is not reachable as "api" on the internal network.
ENV API_UPSTREAM=http://api:3000

# The image entrypoint runs envsubst on this template at startup and writes
# the result to /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Static assets
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
