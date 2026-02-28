FROM node:20-alpine AS build
WORKDIR /app
ARG FRONTEND_BASE_PATH=/
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_BASE_PATH=${FRONTEND_BASE_PATH}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN test -f /usr/share/nginx/html/index.html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/10-normalize-base-path.envsh /docker-entrypoint.d/10-normalize-base-path.envsh
RUN chmod +x /docker-entrypoint.d/10-normalize-base-path.envsh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
