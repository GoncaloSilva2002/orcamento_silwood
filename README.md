# Silwood — Simulador de orçamentos

Aplicação Node.js para orçamentos de cozinhas e roupeiros. Os cálculos correm em JavaScript e o catálogo é guardado no Supabase. O funcionamento diário não requer Excel, ficheiros XLSM nem PowerShell.

## Arrancar

Executa npm install e npm start. Abre http://localhost:3000. Configura as credenciais do servidor em .env, seguindo .env.example.

## Supabase

1. Executa supabase/schema.sql para utilizadores e histórico, se ainda não estiver aplicado.
2. Executa supabase/catalog.sql no SQL Editor para criar o catálogo.
3. Configura SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY em .env.
4. Executa npm run migrate:supabase uma única vez.
5. Define CATALOG_STORAGE=supabase e inicia/reinicia a aplicação.

A importação usa data/catalog-seed.json, já extraído do Excel do projeto com os preços guardados e alterações pendentes existentes na migração. Se existir data/catalog-local.json, importa esse catálogo atualizado. A importação recusa substituir um catálogo que já exista.

O catálogo fica separado por tabelas no Supabase: placas, orlas, extras, ferragens, sistemas, pinturas, receitas e componentes. A tabela app_catalog_meta guarda apenas listas auxiliares, modelos de módulos, preços de pés e a revisão. A aplicação junta essas tabelas em memória antes de calcular os orçamentos.

A aplicação lê o catálogo do Supabase antes das operações de consulta, cálculo e gravação. As gravações passam pela autorização de administrador no servidor. Se a base de dados estiver indisponível, apresenta um erro e não grava silenciosamente numa cópia local. A chave service_role fica exclusivamente no servidor.

## Desenvolvimento sem Supabase

Define CATALOG_STORAGE=local. O catálogo inicial vem de data/catalog-seed.json e as alterações ficam em data/catalog-local.json. Este modo destina-se a uma única instância local. A autenticação continua a usar Supabase quando as respetivas variáveis estão configuradas.

## Cálculos e ficheiros antigos

src/pricing-engine.js contém os cálculos de módulos já usados pelo simulador, preservados na migração. src/server.js calcula os totais e os acessórios. src/workbook-data.js é apenas uma entrada de compatibilidade para o catálogo JSON.

O ficheiro XLSM, config/calculator.json e os scripts excel-*.ps1 são referências antigas, sem utilização pela aplicação. A migração cobre as funcionalidades do simulador; não executa macros nem recria todas as folhas e relatórios do livro Excel.

## Verificação

Executa npm run check e npm test. Os testes verificam 30 casos de preços anteriores à migração, persistência, conflitos, erros do Supabase e as rotas da aplicação com leituras de Excel e execução de processos bloqueadas.
