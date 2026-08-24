# Base images come from AWS's public ECR mirror of Docker Official Images
# (public.ecr.aws/docker/library/*) instead of Docker Hub — Hub's anonymous
# pull-rate limit (HTTP 429 "toomanyrequests") was breaking CI builds. The ECR
# mirror needs no auth and isn't rate-limited; tags match Docker Hub 1:1.
FROM public.ecr.aws/docker/library/node:22.22.3-slim AS builder
WORKDIR /app
COPY apps/xyne-claw-auth/frontend/package*.json ./
RUN npm ci
COPY apps/xyne-claw-auth/frontend/tsconfig.json apps/xyne-claw-auth/frontend/vite.config.ts apps/xyne-claw-auth/frontend/vite-env.d.ts apps/xyne-claw-auth/frontend/index.html ./
COPY apps/xyne-claw-auth/frontend/src ./src
RUN npm run build

FROM public.ecr.aws/docker/library/nginx:stable-alpine AS runner

# Run nginx non-root (same hardening as apps/dashboard + the claw/claw-auth
# backend images): a UID/GID 1001 user that owns every path nginx writes to.
# Without this, a pod securityContext enforcing runAsNonRoot crashes nginx at
# startup: mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied).
RUN rm /etc/nginx/conf.d/default.conf && \
    addgroup --system --gid 1001 frontend && \
    adduser --system --uid 1001 frontend

# Assets are built with /claw/ base path, serve from /claw/
RUN mkdir -p /usr/share/nginx/html/claw
COPY --from=builder --chown=frontend:frontend /app/dist /usr/share/nginx/html/claw

RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    client_max_body_size 50m;\n\
    client_body_timeout 60s;\n\
\n\
    location /claw/api/v1 {\n\
        proxy_pass http://xyne-claw-auth:3003;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
    }\n\
\n\
    location /claw/ {\n\
        try_files $uri $uri/ /claw/index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

# Hand nginx's runtime-write paths to the frontend user: cache/temp dirs,
# logs, conf.d (the docker-entrypoint scripts sed default.conf in place) and
# the pid file. Pre-created + owned in the image so no runtime chown is needed.
RUN chown -R frontend:frontend /var/cache/nginx && \
    chown -R frontend:frontend /var/log/nginx && \
    chown -R frontend:frontend /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown frontend:frontend /var/run/nginx.pid

USER frontend

# Still listening on :80, so running non-root requires the pod to allow
# unprivileged binds on privileged ports:
#   securityContext.sysctls: net.ipv4.ip_unprivileged_port_start = "0"
# (safe system-wide-safe sysctl, K8s 1.22+; dashboard opted for :8080 instead)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
