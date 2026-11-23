# RIPD: Relatório de Impacto à Proteção de Dados Pessoais

Projeto: Extrato Falado · Versão: 1 · Atualização: 22 de novembro de 2026 · Responsável pela revisão: controlador (contato: eliascamposdev@gmail.com; [aviso de privacidade](PRIVACIDADE.md))

## 1. Descrição do tratamento

O Extrato Falado é um chat em português sobre extrato bancário. Fora da demo, é possível importar CSV/OFX/PDF, definir orçamentos e recorrências; na demo o visitante apenas consulta e registra lançamentos manuais. O planner é heurístico e offline por padrão; com `PLANNER=openai` e autorização `llm`, ele usa um provedor externo apenas para traduzir a pergunta em `QuerySpec`. Os números são sempre calculados pelo SQLite.

A demo pública em <https://extrato-falado.onrender.com> roda no Render (plano free, Oregon/EUA). A demo é ativada por `PUBLIC_DEMO=1`; fora dela (desenvolvimento local e testes), nada muda. Não há cadastro de usuário, analytics, telemetria nem fontes remotas de dados. O OCR com `tesseract.js` é local e o modelo `por.traineddata` é baixado no build do Docker.

Os dados e as finalidades estão detalhados em [PRIVACIDADE.md](PRIVACIDADE.md) e [ROPA.md](ROPA.md).

## 2. Necessidade e proporcionalidade

O tratamento é necessário para a finalidade declarada: responder com precisão sobre um extrato e permitir a organização dos lançamentos. Medidas de minimização e proporcionalidade adotadas:

- pergunta limitada a 300 caracteres;
- planner heurístico por padrão, sem envio de dados a terceiros;
- LLM opcional, dependente de consentimento específico (`llm`);
- nenhum valor agregado passa pelo modelo; o SQLite produz os números;
- importação, edição do extrato, orçamentos e recorrências bloqueados na demo (`403`), eliminando a coleta de extrato real nela;
- redutor de `[CPF]`, `[EMAIL]`, `[TELEFONE]` e `[NUMERO]` mantido como defesa em profundidade, sem aplicação na demo;
- isolamento de manuais e consentimentos por `extrato_sid`, com o servidor guardando apenas o SHA-256 do cookie;
- consentimento prévio e retirada facilitada; direitos acessíveis por `/api/me`, `DELETE /api/me` e `DELETE /api/consent`;
- retenção curta de 30 dias para manuais e consentimentos **na demo**; fora dela não há purga automática, e dados importados não são isolados por sessão;
- `/api/reset` com modos explícitos: `imported` (padrão) apaga só transações importadas, `sample` restaura a amostra e `all` cobre todas as tabelas; modo inválido é recusado;
- `/api/health` sem contagens, contas e fontes na demo pública; rate limit em memória e logs sem dados pessoais.

Alternativa menos impactante recomendada ao visitante: usar a demo apenas para consulta e lançamentos manuais, ou rodar o projeto localmente com a amostra fictícia; nunca importar extrato real em instância compartilhada.

## 3. Riscos identificados

| ID | Risco | Impacto | Probabilidade | Observação |
|---|---|---|---|---|
| R-1 | Exposição de extrato real em instância compartilhada com importação aberta | Alto | Baixa | Na demo a importação está bloqueada; o risco remanescente exige uma instância fora da demo com dados reais |
| R-2 | PII de terceiros em descrições importadas fora da demo: nomes não são removidos pelo redutor de padrões | Médio/alto | Baixa | Sem importação na demo, só se aplica a instâncias locais compartilhadas; descrições de Caixa/BB/PicPay/Santander são citadas no mapeamento |
| R-3 | Transferência internacional e compartilhamento com Render e provedor de LLM sem instrumento contratual verificado | Médio | Média | Base prevista: cláusulas-padrão da Res. CD/ANPD nº 19/2024; formalização é responsabilidade do controlador |
| R-4 | Exposição adicional em PDFs exportados e em mensagens de erro de importação, que replicam descrições, SQL, parâmetros, `QuerySpec`, saldos e entradas inválidas | Médio | Média | Depende também do que o visitante faz com o arquivo baixado |
| R-5 | Perda ou indisponibilidade de dados importados no plano free (sem disco persistente; reciclagem por dormência/redeploy) | Médio (disponibilidade) | Alta | Baixo impacto para dados fictícios de demonstração |
| R-6 | Acesso indevido à sessão de outro visitante | Médio | Baixa | Cookie `HttpOnly`/`Secure`/`SameSite=Lax`; hash SHA-256 no servidor; isolamento por sessão para registros manuais |
| R-7 | Dado sensível por inferência (art. 5, II e art. 11, §1º) presente em descrição importada | Alto | Baixa | O banner não coleta consentimento específico para dado sensível; a orientação é não importar esse arquivo |
| R-8 | Consentimento inválido por informação insuficiente ou ausência de prova | Médio | Baixa | Banner bloqueia os manuais; registro com timestamp em `consents`; aviso precisa ser mantido atualizado |

## 4. Mitigações: implementado x pendente

### Implementado (conforme decisões de implementação)

| Risco atendido | Medida |
|---|---|
| R-1, R-6 | Demo por `PUBLIC_DEMO=1`, com importação e edição do extrato bloqueadas; cookie anônimo `extrato_sid` com SHA-256 no servidor; isolamento de lançamentos manuais e consentimentos por sessão; aviso explícito de que a demo é compartilhada |
| R-2, R-7 | Redutor de CPF/e-mail/sequências longas mantido como defesa em profundidade; risco de nomes de terceiros documentado como residual para instâncias com importação aberta |
| R-3 | Aviso sobre Render (EUA/Oregon), LLM opcional e base contratual via Res. CD/ANPD nº 19/2024; consentimento separado para `llm` |
| R-4, R-6 | `/api/health` sem contagens/contas/fontes na demo, `publicDemo: true` e `ephemeral` calculado; rate limit de 30 consultas/min e 120 requisições/min por hash de sessão; eventos sem dados pessoais em log; aviso sobre PDFs e erros |
| R-5 | TTL de 30 dias (`RETENTION_DAYS`) para manuais e consentimentos apenas na demo; fora da demo a exclusão depende de ação manual. `/api/reset`: padrão `imported` remove só transações importadas, `sample` restaura a amostra e `all` cobre todas as tabelas |
| R-8 | Banner de consentimento com `privacy`, `over18`, `shareNotice`, `llm`, registrado com timestamp; retirada por `DELETE /api/consent`; direitos via `GET/DELETE /api/me` |

### Pendências do controlador

1. Formalizar/verificar instrumentos contratuais e cláusulas-padrão (Res. CD/ANPD nº 19/2024) com Render e com cada provedor de LLM efetivamente usado; manter registro das entidades compartilhadas.
2. Publicar os dados completos de identificação do controlador; o e-mail de contato já está publicado e não há DPO designado.
3. Para instâncias com importação aberta, avaliar remoção ou ofuscação de nomes de terceiros nas descrições e revisar a exposição de saldos/entradas inválidas em mensagens de erro.
4. Definir e documentar prazo/critérios de retenção dos logs operacionais sem dados pessoais; o limite de requisições já usa hash de sessão e não registra IP.
5. Para uso com extrato real, migrar para instância privada ou persistente com controle de acesso; a demo pública não aceita importação.
6. Revisar PDFs exportados antes de compartilhá-los e orientar o visitante sobre o conteúdo replicado.

## 5. Conclusão

Para a **demo pública**, os riscos residualmente aceitáveis são: exposição de arquivos exportados pelo próprio visitante, natureza compartilhada da instância e instituições contratuais ainda não formalizadas. Como a demo não importa arquivos, não há dados de extrato globalmente visíveis nela; o isolamento por sessão protege os lançamentos manuais.

O tratamento **não deve ser considerado adequado para extrato bancário real** enquanto as pendências 1, 2 e 5 não forem resolvidas. O uso local, com planner heurístico e amostra fictícia, é a via recomendada.

## 6. Revisão

Este RIPD deve ser revisado quando houver mudança de finalidade, de provedores, de hospedagem, de configuração de persistência ou de mecanismos de consentimento, e ao menos uma vez ao ano. Registre a data e o responsável da revisão no repositório e comunique alterações relevantes pelo e-mail de contato.
