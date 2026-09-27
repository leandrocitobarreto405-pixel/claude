# Imagem do Nexa OS para o Google Cloud Run (servidor Node).
# O Lovable continua usando o próprio build; este arquivo só é usado fora dele.

FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g bun@1.3.11
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
# Endereço e chave PÚBLICA do Supabase (vão para o navegador; a proteção dos dados é o RLS).
# Projeto "Nexa OS Sao Paulo" (sa-east-1). Para outro projeto, troque aqui ou passe --build-arg.
ARG VITE_SUPABASE_URL=https://avvxapeplhuiruijyyed.supabase.co
ARG VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_LTVVQv5nB5G0WWyVkehTWg_8O3q3BGz
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
RUN NITRO_PRESET=node-server npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
