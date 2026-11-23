# Checklist de privacidade para futuras alterações

Use antes de mexer em rotas, banco, interface ou textos LGPD. A regra é simples: se o dado muda de escopo, de prazo ou de destino, todos os documentos e testes precisam acompanhar.

## 1. Escopo do dado

- [ ] O dado é da sessão ou global? Dados da sessão usam `session_hash` (cookie `extrato_sid` com SHA-256). Dados importados são globais por instalação e **não** entram em `/api/me`.
- [ ] Se entrou uma tabela nova, ela foi incluída em `sessionData`, `deleteSessionData` e, se for dado de sessão, em `deleteExpiredSessionData` (`src/privacy.ts`)?
- [ ] Se for dado de sessão, a consulta filtra por `session_hash`? Rotas novas precisam passar o `scope` de `sessionScope(req, res)`.
- [ ] Se for global, a documentação diz explicitamente que não é isolado por visitante?

## 2. Demo pública (`PUBLIC_DEMO=1`)

- [ ] A rota nova é leitura ou escrita do visitante? Escrita fora de manuais/consentimento deve continuar respondendo `403` pelo guard em `src/server.ts`.
- [ ] Se a rota faz envio a terceiro, ela depende do consentimento `llm`? Sem ele, o planner heurístico permanece (`plannerFor`).
- [ ] Nenhuma rota nova cai em modo destrutivo com valor inválido: enumere os valores aceitos, recuse qualquer outro com `400` antes de qualquer `DELETE`/`UPDATE` amplo.
- [ ] Nenhuma contagem, conta ou fonte do extrato vazou no `/api/health` da demo.

## 3. Retenção e reset

- [ ] A purga de 30 dias continua restrita à demo e a registros com `session_hash` (`deleteExpiredSessionData`)? Fora da demo não há exclusão automática.
- [ ] Se o prazo mudou, `RETENTION_DAYS`, o cookie e os textos (README, aviso em HTML, PRIVACIDADE, ROPA, RIPD) foram atualizados juntos?
- [ ] `/api/reset` manteve os modos `imported`, `sample` e `all` com valor inválido recusado? O padrão continua `imported`, o menos destrutivo.
- [ ] Se uma tabela nova puder conter dado sensível, ela entrou em `clearAllUserData` (`src/privacy.ts`, modo `all`)?

## 4. Documentação e interface

- [ ] Aviso de privacidade (`docs/PRIVACIDADE.md`), ROPA, RIPD e a versão HTML (`web/public/privacidade.html`) concordam entre si e com o código.
- [ ] O e-mail de contato está correto: **eliascamposdev@gmail.com**.
- [ ] Capitalização restrita à interface: código, comandos e nomes de arquivo permanecem minúsculos.
- [ ] Nenhum travessão longo (U+2014) foi reintroduzido; meios-travessões (U+2013) de intervalo e código são permitidos.

## 5. Validação antes do push

- [ ] `npm test`, `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- [ ] Teste novo cobre o comportamento de privacidade alterado (isolamento entre sessões, consentimento, retenção, modo inválido).
- [ ] Se a contagem de testes mudou, README e perfil do GitHub foram atualizados. O LinkedIn **nunca** recebe número de testes.
- [ ] Render respondeu `ok: true` com `publicDemo: true` após o deploy, e `/privacidade.html` está no ar.

## Armadilhas já encontradas

- `kind`, `applyAll`, `internalTransfer` e `refund` só ativam com valores estritos; typo não pode virar ação global.
- A importação apaga a amostra (`source='sample'`) após um arquivo reconhecido, mas nunca apaga dado importado por causa de parâmetro inválido.
- `source=all` é leitura ampla, não modo de exclusão.
- O `/api/reset` não existe na demo (responde `403`), então a validação do modo só é observável fora dela.
