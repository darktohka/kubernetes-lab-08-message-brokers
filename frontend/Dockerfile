# Build stage: force the builder platform so vite/tsc run natively (no qemu).
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5-alpine AS build
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
RUN bun run build

# Runtime: nginx resolves to the target platform (linux/arm64 on the cluster).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
