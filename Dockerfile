FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=
ARG SUPABASE_PUBLIC_URL
ARG SUPABASE_PUBLIC_ANON
RUN VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_SUPABASE_URL="$SUPABASE_PUBLIC_URL" VITE_SUPABASE_ANON_KEY="$SUPABASE_PUBLIC_ANON" npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
