# Build stage: compile the Vite app to static assets.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* vars into the bundle at build time, so they must be
# supplied as build args (docker build --build-arg VITE_SUPABASE_URL=...),
# not runtime env vars.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# Serve stage: nginx serving the static build output.
FROM nginx:alpine AS serve

# Pick up patched Alpine packages (openssl, nghttp2, etc.) ahead of the
# next nginx:alpine image refresh — see `docker scout cves` on this image.
RUN apk update && apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
