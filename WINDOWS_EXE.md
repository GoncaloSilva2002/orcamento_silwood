# App Silwood em executavel Windows

Este modo serve para usar a app no servidor Windows sem instalar Node.js nesse servidor.

## Criar o executavel

Num computador onde tenhas Node.js instalado, corre:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-exe.ps1
```

Isto cria a pasta:

```text
dist\silwood-orcamentos-windows
```

Essa pasta contem:

- `silwood-orcamentos.exe`
- `public\`
- `data\`
- `scripts\`
- `config\`
- `.env.example`

## Instalar no servidor

1. Copia a pasta `dist\silwood-orcamentos-windows` para o servidor.
2. Renomeia `.env.example` para `.env`.
3. Preenche o `.env` com as chaves Supabase.
4. Executa:

```powershell
.\silwood-orcamentos.exe
```

A app fica disponivel em:

```text
http://localhost:3000
```

Noutros computadores da empresa, usa o IP do servidor:

```text
http://IP-DO-SERVIDOR:3000
```

Exemplo:

```text
http://192.168.1.50:3000
```

## Ficheiro `.env`

Exemplo:

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

SUPABASE_URL=https://teu-projeto.supabase.co
SUPABASE_ANON_KEY=publishable-key
SUPABASE_SERVICE_ROLE_KEY=service-role-key

SILWOOD_ADMIN_USER=admin
SILWOOD_ADMIN_PASSWORD=uma-password-temporaria
SILWOOD_BOOTSTRAP_ADMIN=true
```

Depois de criares o primeiro admin real na app, muda:

```env
SILWOOD_BOOTSTRAP_ADMIN=false
```

E reinicia o `.exe`.

## Notas importantes

- A pasta `data\` tem de ficar ao lado do `.exe`.
- O ficheiro `.env` tem de ficar ao lado do `.exe`.
- A `SUPABASE_SERVICE_ROLE_KEY` nunca deve ser partilhada nem colocada no frontend.
- Para a empresa aceder de outros computadores, abre a porta no firewall ou coloca IIS/Nginx/Caddy como proxy HTTPS.
