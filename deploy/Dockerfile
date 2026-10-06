# PCP Digital Portal app image (Next.js). Built on the server by deploy/deploy.sh.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The demo build: one-click personas, presenter guide and autofill buttons (inlined at build time)
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_DEMO_MODE=1
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
EXPOSE 3150
CMD ["sh", "deploy/app-start.sh"]
