# Silwood Simulador de Orcamentos

App Node.js para simular orcamentos de cozinhas usando o ficheiro Excel .xlsm como base.

## O que mudou

A interface principal replica as folhas do workbook:

- Orcamento_Cozinhas
- Orcamento_Final

A app mostra as grelhas com valores, formulas, cores, alinhamentos e celulas unidas lidas diretamente pelo Microsoft Excel. As celulas amarelas sao as celulas editaveis configuradas em config/calculator.json.

## Como funciona

- O Excel original nao e alterado.
- A app usa a copia em data/Silwood_Calculadora_Orcamentos_Cozinhas.xlsm.
- Cada recalculo cria uma copia temporaria do workbook.
- As alteracoes feitas na grelha sao escritas nas celulas correspondentes.
- O Microsoft Excel recalcula o ficheiro.
- A app volta a ler Orcamento_Cozinhas e Orcamento_Final para manter as ligacoes iguais ao workbook.

## Arrancar

```powershell
cd C:\Users\USER\Documents\Codex\2026-07-02\qu
npm.cmd install
npm.cmd start
```

Depois abra http://localhost:3000.

## Configuracao

Edite config/calculator.json para ajustar:

- views: folhas e intervalos visiveis na app;
- editableCells: celulas que podem ser alteradas na interface;
- outputs: totais destacados no topo.

Para manter o resultado certo, nao copie formulas para JavaScript. A logica deve continuar no Excel.
