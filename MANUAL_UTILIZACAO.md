# Manual de Utilização - Silwood Simulador de Orçamentos

Este documento explica como usar a app de orçamentos Silwood no dia a dia.

## 1. Abrir a app

1. Abrir o PowerShell.
2. Entrar na pasta da app:

```powershell
cd C:\Users\USER\Documents\Codex\2026-07-02\qu
```

3. Iniciar a app:

```powershell
node src\server.js
```

4. Abrir no navegador:

```text
http://localhost:3000
```

Enquanto a app estiver a ser usada, o PowerShell deve ficar aberto.

## 2. Modos de utilização

### Modo normal

É o modo para criar orçamentos.

Neste modo é possível:

- Criar orçamento para cliente.
- Criar orçamento revendedor.
- Adicionar módulos.
- Adicionar extras.
- Guardar no histórico.
- Imprimir.
- Ver a visualização dos módulos.

Neste modo não aparecem:

- Custos para a empresa.
- Margem de lucro.
- Aba de mudar preços de fornecedores.

### Modo administrador

O modo administrador serve para gerir preços e ver informação interna.

Permite:

- Ver custo do orçamento.
- Ver margem de lucro.
- Alterar preços de fornecedor.
- Alterar preços de cliente e revendedor.
- Adicionar novos itens.
- Eliminar itens.
- Guardar alterações de preços.

As credenciais padrão atuais são:

```text
Utilizador: admin
Palavra-passe: silwood
```

Estas credenciais podem ser alteradas no servidor através das variáveis `SILWOOD_ADMIN_USER` e `SILWOOD_ADMIN_PASSWORD`.

## 3. Menu lateral

O menu lateral tem as principais áreas da app:

- **Orçamento**: orçamento normal para cliente.
- **Orçamento revendedor**: igual ao orçamento normal, mas usando preços de revendedor.
- **Visualização**: mostra os módulos desenhados de forma visual.
- **Mudar preço fornecedores**: apenas aparece no modo administrador.

Também existem botões laterais:

- **Novo orçamento**: limpa o orçamento atual e cria um novo rascunho.
- **Imprimir**: gera o documento para impressão/PDF.
- **Guardar no histórico**: guarda o orçamento atual no histórico.

## 4. Dados do cliente

No topo do orçamento preencher:

- Cliente.
- Local.
- Data.

Estes dados são usados no orçamento, no histórico e no nome do ficheiro ao imprimir.

## 5. Criar módulos

Na zona **Módulos**, clicar em:

```text
+ Adicionar caixote
```

Depois preencher:

- Tipo.
- Quantidade.
- Largura.
- Altura.
- Profundidade.
- Número de portas.
- Prateleiras.
- Interior.
- Exterior.
- Pintura.
- Sistema de abertura.
- Dobradiça.
- Orla.
- Topos cima/baixo.
- Topos laterais.
- Costa.
- Divisória.

### Tipos de módulo

Existem estes tipos:

- Inferior.
- Superior.
- Coluna.
- Roupeiro.
- Peça/placa.

O tipo **Roupeiro** usa a mesma lógica de cálculo da coluna, mas aparece no orçamento como roupeiro.

### Pesquisa de madeiras

Nos campos **Interior** e **Exterior**, podes escrever parte do nome, referência ou espessura.

Exemplos:

```text
mdf 19
f067 16
egger preto
betula carvalho
```

A app tenta encontrar o material mesmo que escrevas sem hífens ou numa ordem diferente.

## 6. Extras

Na zona **Extras & Final**, clicar em:

```text
+ Adicionar extra
```

Escolher primeiro o grupo e depois o item.

Os itens dos extras também têm pesquisa: podes começar a escrever e aparecem apenas as opções relacionadas.

### Grupos principais de extras

- Puxadores.
- Rodapés.
- Acessórios Cozinha.
- Cestos do Lixo.
- LED'S.
- Tomadas.
- Pés, Fixação e Organização.
- Acessórios Roupeiro.
- Gavetas.
- Gavetas Roupeiro.
- Transporte e embalamento.
- Outros.

### Outros

Usar **Outros** quando o extra não existir na base de preços.

Neste caso, preencher manualmente:

- Descrição.
- Quantidade.
- Preço unitário.
- Custo unitário.

### Transporte e embalamento

Este grupo serve para custos variáveis.

Opções disponíveis:

- Carga + Transporte + Embalamento.
- Embalamento + Carga.

O preço deve ser colocado manualmente no orçamento, porque varia de obra para obra.

## 7. Gavetas

### Gavetas de cozinha

Usar o grupo **Gavetas**.

Estas gavetas são extras fixos, com preço vindo da base de preços.

Se necessário, escolher o módulo a que pertencem para a visualização ficar correta.

### Gavetas de roupeiro

Usar o grupo **Gavetas Roupeiro**.

Estas gavetas são calculadas pelas medidas e pelo material do módulo.

A app permite escolher:

- Módulo.
- Material.
- Corrediça.
- Quantidade.
- Largura.
- Profundidade.
- Altura.

Também existe a opção **Dividir por módulo**, útil quando há várias gavetas distribuídas por diferentes roupeiros.

## 8. Visualização

A aba **Visualização** mostra os módulos de forma gráfica.

A visualização acompanha:

- Tipo do módulo.
- Medidas.
- Portas.
- Prateleiras.
- Divisórias.
- Gavetas.
- Cores aproximadas dos materiais.

Esta visualização também é guardada com o orçamento e aparece numa página extra quando se imprime.

## 9. Histórico e rascunhos

### Rascunhos

A app guarda automaticamente o orçamento atual como rascunho.

Isto ajuda a não perder trabalho se a página for atualizada ou fechada.

### Guardar no histórico

Quando o orçamento estiver pronto, clicar em:

```text
Guardar no histórico
```

O orçamento fica guardado pelo nome do cliente e data.

Ao abrir um orçamento do histórico, a app repõe:

- Dados do cliente.
- Módulos.
- Extras.
- Visualização.
- Tipo de orçamento.

### Apagar histórico ou rascunhos

Cada item do histórico/rascunho tem um botão `X`.

Ao clicar, a app pergunta antes de apagar.

## 10. Imprimir / Guardar PDF

Para imprimir ou guardar em PDF:

1. Clicar em **Imprimir**.
2. Escolher impressora ou **Guardar como PDF**.
3. Confirmar.

O nome sugerido do ficheiro inclui:

```text
Silwood_Orçamento_[Nome do cliente]_[Data]
```

A impressão inclui:

- Dados do cliente.
- Linhas do orçamento.
- Total.
- Página extra com visualização dos módulos.

## 11. Alterar preços de fornecedores

Esta parte só está disponível em modo administrador.

Entrar na aba:

```text
Mudar preço fornecedores
```

Aqui é possível alterar ou adicionar itens em:

- Madeiras / Placas.
- Pinturas.
- Sistemas de abertura.
- Dobradiças / Ferragens.
- Orlas.
- Puxadores.
- Rodapés.
- Acessórios Cozinha.
- Cestos do Lixo.
- LED'S.
- Tomadas.
- Pés, Fixação e Organização.
- Acessórios Roupeiro.
- Gavetas.
- Outros.

Depois de alterar preços, clicar em:

```text
Guardar preços
```

A app guarda primeiro na própria app e sincroniza depois com o Excel quando possível.

## 12. Preços automáticos e manuais

A app calcula automaticamente:

- Custo.
- Preço cliente.
- Preço revendedor.

Em modo administrador, é possível alterar manualmente o preço cliente ou revendedor.

Se quiser voltar ao preço automático, clicar em:

```text
Auto
```

## 13. Cuidados importantes

- Não fechar o PowerShell enquanto estiver a usar a app.
- Se o Excel estiver aberto e a app não conseguir guardar, fechar o Excel e tentar novamente.
- Usar **Guardar no histórico** quando o orçamento estiver pronto.
- Usar **Novo orçamento** apenas quando quiser começar uma obra nova.
- Alterações de preços devem ser feitas em modo administrador.
- Antes de entregar um orçamento, confirmar sempre medidas, materiais, portas, extras e totais.

## 14. Resumo rápido

Fluxo recomendado:

1. Abrir a app.
2. Preencher dados do cliente.
3. Adicionar módulos.
4. Adicionar extras.
5. Ver a visualização.
6. Confirmar totais.
7. Guardar no histórico.
8. Imprimir ou guardar PDF.

