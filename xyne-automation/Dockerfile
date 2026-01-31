# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN mkdir -p /app/reports

CMD ["tail", "-f", "/dev/null"]
