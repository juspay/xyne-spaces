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

RUN rm /etc/nginx/conf.d/default.conf

# Assets are built with /claw/ base path, serve from /claw/
RUN mkdir -p /usr/share/nginx/html/claw
COPY --from=builder /app/dist /usr/share/nginx/html/claw

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

# Run as the image's built-in non-root "nginx" user. The master no longer runs as
# root, so the pid file and the dirs nginx writes at runtime are relocated/owned
# accordingly. The port stays 80 (no Service targetPort change); binding a
# privileged port as non-root requires NET_BIND_SERVICE, which the pod's
# securityContext.capabilities must add (add: ["NET_BIND_SERVICE"]) in the deploy
# manifest — otherwise nginx fails to bind on startup.
RUN sed -i 's|pid .*nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx/conf.d

EXPOSE 80

USER nginx

CMD ["nginx", "-g", "daemon off;"]
