# Production web image: build the React app, then serve the static files with
# Caddy. Build context: ./frontend; the Caddyfile comes from the "deploy"
# additional context (docker-compose.prod.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Vite writes these into the bundle at build time. They are public values:
# the API path and the Firebase web configuration.
ARG VITE_API_URL=/api
ARG VITE_PRIVACY_CONTACT_EMAIL
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
# Keeps the build inside a 2 GB server (with swap).
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

FROM caddy:2-alpine
COPY --from=deploy Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
