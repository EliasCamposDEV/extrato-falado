# INCIDENTES: runbook de resposta a incidentes de dados pessoais

Projeto: Extrato Falado · Atualização: 22 de novembro de 2026 · Aviso de privacidade: [PRIVACIDADE.md](PRIVACIDADE.md) · RIPD: [RIPD.md](RIPD.md)

Canal de contato para suspeitas e comunicações: **eliascamposdev@gmail.com**. Para falhas técnicas sem dados pessoais, use também as [issues](https://github.com/EliasCamposDEV/extrato-falado/issues). **Nunca cole extratos, CPFs, saldos ou descrições originais em uma issue.**

## 1. Quando acionar

Acione este runbook diante de qualquer sinal de:

- exposição de dados importados a visitantes não autorizados em instância compartilhada com importação aberta;
- vazamento ou uso indevido de `extrato_sid`;
- envio indevido de pergunta/contexto a provedor de LLM sem o consentimento `llm`;
- exposição de contagens, contas ou fontes por `/api/health` na demo pública;
- PDFs, mensagens de erro ou logs contendo dados pessoais fora do controle do projeto;
- perda, alteração ou exclusão indevida de dados; indisponibilidade prolongada da instância.

Qualquer pessoa pode avisar pelo e-mail acima. Registre quem avisou, quando e por qual meio, sem copiar dados pessoais para o registro.

## 2. Classificação interna

A classificação abaixo é **operacional do projeto**, não uma categoria oficial da ANPD.

| Nível | Critério | Exemplo |
|---|---|---|
| I (crítico) | Dados pessoais reais, sensíveis ou de terceiros foram expostos, copiados ou alterados sem autorização | Extrato real importado em instância compartilhada e visível por outros visitantes; CPF em descrição exposta |
| II (relevante) | Houve acesso indevido ou risco concreto, sem confirmação de leitura/cópia | Sessão de outro visitante acessada; LLM chamado sem consentimento; `/api/health` retornando detalhes na demo |
| III (limitado) | Evento sem exposição de dados pessoais, mas que indica falha a corrigir | Pico de requisições, erro que ecoa saldo sem impacto externo, instância reciclada com perda de dados fictícios |

Na dúvida, classifique no nível mais alto e reclassifique depois com evidências.

## 3. Contenção (imediatamente)

1. **Isole a causa.** Se um cookie de sessão estiver envolvido, descarte as sessões afetadas e rotacione o `extrato_sid` dos visitantes impactados.
2. **Desligue o que não é necessário.** Se o LLM estiver envolvido, ajuste `PLANNER` para o heurístico e revogue/rotacione as chaves de API em `.env`/painel.
3. **Remova o conteúdo exposto.** Use `POST /api/reset` para limpar todas as tabelas quando o acesso estiver disponível; se não estiver, redeploy da instância free descarta os dados importados. Peça ao visitante que apague PDFs baixados com dados pessoais e que use `DELETE /api/me` para os próprios registros de sessão.
4. **Verifique a configuração pública.** Confirme que `/api/health` na demo omite contagens, contas e fontes, traz `publicDemo: true`, `readOnly: true` e calcula `ephemeral` corretamente; confirme que importar/editar responde `403` e que o rate limit está ativo.
5. **Preserve o que importa.** Guarde horários, rotas, status HTTP e hashes/opacidades, nunca o conteúdo dos dados. Veja a seção 5.

Não reinicie nem limpe tudo antes de registrar as evidências não pessoais, salvo se a continuidade da exposição for imediata: nesse caso, contenha primeiro.

## 4. Comunicação

- Comunique a **ANPD** e os **titulares afetados** quando o evento exigir comunicação, **conforme o prazo vigente da ANPD**. Não use prazo fixo inventado: confira a resolução/norma vigente no momento do incidente.
- O aviso deve conter, no mínimo: natureza do incidente, categorias de dados e titulares afetados (sem revelar dados pessoais na comunicação pública), medidas adotadas, riscos prováveis e forma de contato com o controlador.
- Para titulares, use o e-mail de contato acima ou os canais da interface. Para a ANPD, use o canal oficial vigente.
- Se houver dúvida sobre a obrigatoriedade da comunicação, registre a decisão e o fundamento. A comunicação à ANPD não substitui a comunicação ao titular, nem o contrário.
- Comunique também o provedor envolvido (Render ou provedor de LLM) quando o contrato ou a política dele exigir; a formalização dessas obrigações é responsabilidade do controlador.

## 5. Evidências sem dados pessoais

Registre em arquivo interno:

- data/hora (com fuso) de detecção, contenção e descoberta da causa;
- rotas afetadas (`/api/import`, `/api/health`, `/api/me` etc.), método HTTP e códigos de status;
- quantidades agregadas (nº de requisições, nº de sessões afetadas) e identificadores opacos, como `session_hash` (SHA-256);
- configuração relevante sem segredos: modo demo ativo ou não, `PLANNER`, presença/ausência de persistência, flags de consentimento agregadas;
- ações tomadas, responsável por cada ação e horário.

**Não registre:** descrições de lançamentos, merchants, nomes, CPFs, e-mails, saldos, valores originais, parâmetros de consulta com texto livre, PDFs exportados nem chaves de API. Se algum desses itens aparecer no log, trate o próprio log como dado pessoal e restrinja o acesso.

## 6. Recuperação e pós-incidente

1. Restaure o serviço somente após a causa raiz estar corrigida; rode `npm test` e `npm run typecheck` antes do redeploy (quando a mudança tocar código).
2. Confirme com visitantes afetados que a exclusão/retirada foi concluída, quando couber, e registre a confirmação sem dados pessoais.
3. Atualize [RIPD.md](RIPD.md) e [ROPA.md](ROPA.md) se o incidente revelar risco ou operação não documentada; atualize [PRIVACIDADE.md](PRIVACIDADE.md) se a mudança alterar prazos, finalidades ou compartilhamento.
4. Faça uma revisão curta: o que falhou, o que funcionou, o que mudar (controles, documentação, contratos). Atribua cada pendência a um responsável e a uma data de revisão.
5. Guarde o registro do incidente pelo tempo necessário para prestação de contas, sem dados pessoais, e mantenha o histórico no repositório.
