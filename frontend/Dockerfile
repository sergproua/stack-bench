FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
ARG FRONTEND_BASE_PATH=/
COPY --from=build /app/dist /tmp/dist
COPY nginx.conf /etc/nginx/templates/default-root.conf
COPY nginx.subpath.conf /etc/nginx/templates/default-subpath.conf
RUN set -eux; \
  base="${FRONTEND_BASE_PATH:-/}"; \
  if [ -z "$base" ]; then base="/"; fi; \
  case "$base" in /*) ;; *) base="/$base" ;; esac; \
  if [ "$base" != "/" ]; then base="${base%/}"; fi; \
  target_dir="/usr/share/nginx/html"; \
  if [ "$base" != "/" ]; then target_dir="/usr/share/nginx/html$base"; fi; \
  mkdir -p "$target_dir"; \
  cp -a /tmp/dist/. "$target_dir/"; \
  if [ "$base" = "/" ]; then \
    cp /etc/nginx/templates/default-root.conf /etc/nginx/conf.d/default.conf; \
  else \
    sed "s|__BASE_PATH__|$base|g" /etc/nginx/templates/default-subpath.conf > /etc/nginx/conf.d/default.conf; \
  fi; \
  test -f "$target_dir/index.html"; \
  rm -rf /tmp/dist /etc/nginx/templates/default-root.conf /etc/nginx/templates/default-subpath.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
