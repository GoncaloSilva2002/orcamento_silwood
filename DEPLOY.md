# Deploy da app Silwood

Este guia e para colocar a app num servidor para varias pessoas da empresa usarem pelo browser.

## Requisitos

- Node.js 18 ou superior.
- HTTPS no dominio final.
- Supabase configurado para login, utilizadores e historico.
- Pasta `data/` persistente no servidor, porque contem a base Excel e ficheiros de precos.

## Variaveis de ambiente

Cria um ficheiro `.env` no servidor, na raiz da app:

```env
PORT=3000
NODE_ENV=production

SUPABASE_URL=https://teu-projeto.supabase.co
SUPABASE_ANON_KEY=publishable-key
SUPABASE_SERVICE_ROLE_KEY=service-role-key

SILWOOD_ADMIN_USER=admin
SILWOOD_ADMIN_PASSWORD=trocar-esta-password
SILWOOD_BOOTSTRAP_ADMIN=true
```

Notas:

- `SUPABASE_ANON_KEY` e a publishable key.
- `SUPABASE_SERVICE_ROLE_KEY` fica so no servidor. Nunca colocar esta chave no frontend.
- `SILWOOD_BOOTSTRAP_ADMIN=true` serve apenas para criar o primeiro admin dentro da app.
- Depois de criares e testares um admin real no Supabase, muda para `SILWOOD_BOOTSTRAP_ADMIN=false` e reinicia a app.

## Supabase

No Supabase, abre o SQL Editor e executa:

```text
supabase/schema.sql
```

Isto cria:

- `profiles`, com `role` e `active`.
- `quote_history`, associado ao utilizador dono do orcamento.

## Instalar no servidor

```bash
npm install --omit=dev
npm start
```

A app arranca por defeito em:

```text
http://localhost:3000
```

## Produção com PM2

Uma forma simples de manter a app sempre ligada:

```bash
npm install -g pm2
pm2 start src/server.js --name silwood-orcamentos
pm2 save
pm2 startup
```

Para atualizar depois:

```bash
pm2 restart silwood-orcamentos
```

## Nginx como proxy HTTPS

Exemplo de bloco:

```nginx
server {
  server_name orcamentos.empresa.pt;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Depois ativa HTTPS com Certbot ou pelo painel do alojamento.

## Dados que precisam de backup

Faz backup regular destas pastas/ficheiros:

```text
data/
.env
```

O historico dos orcamentos fica no Supabase.

## Primeiro arranque

1. Arranca a app com `SILWOOD_BOOTSTRAP_ADMIN=true`.
2. Entra com o login local configurado em `SILWOOD_ADMIN_USER` e `SILWOOD_ADMIN_PASSWORD`.
3. Vai a `Utilizadores`.
4. Cria o teu utilizador admin real.
5. Sai e entra com esse utilizador.
6. Muda `SILWOOD_BOOTSTRAP_ADMIN=false`.
7. Reinicia a app.
