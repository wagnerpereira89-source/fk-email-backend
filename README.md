# fk-email-backend

Backend do módulo de e-mail marketing da FK Digital (Amazon SES + Supabase, multi-cliente).

## Stack
- **Hono** (framework HTTP) rodando como Serverless Function na **Vercel**
- **Amazon SES v2** pra envio
- **Supabase** (Postgres) pra dados (contatos, listas, campanhas, eventos)

## Variáveis de ambiente (configurar na Vercel)
Veja `.env.example`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SES_REGION` (ex.: `us-east-2`)
- `SES_ACCESS_KEY_ID`
- `SES_SECRET_ACCESS_KEY`

## Endpoints
- `GET /api/health` — checa se o serviço está no ar
- `POST /api/test-send` — envia um e-mail de teste
  - body: `{ "to": "voce@email.com" }`
  - usa os dados do cliente `adoratta` do Supabase

## Rodar local (opcional)
```
npm install
cp .env.example .env   # preenche os valores
npm run dev            # vercel dev
```

## Deploy
Importar o repositório na Vercel, configurar as envs e dar deploy.
