# Build stage runs natively on the builder (amd64) so `bun install`/`bun build`
# never run under emulation; the runtime stage resolves to the target platform
# (linux/arm64 for this cluster) and only receives the bundle.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5-alpine AS build
WORKDIR /app
COPY package.json ./
RUN bun install
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --target=bun --outdir=dist

FROM oven/bun:1.4.5-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/index.js ./index.js
EXPOSE 3001
USER bun
CMD ["bun", "run", "index.js"]
