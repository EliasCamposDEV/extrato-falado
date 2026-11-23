# Aviso de privacidade: Extrato Falado

Última atualização: 22 de novembro de 2026.

> **Antes de usar a demo pública:** ela é compartilhada e roda no plano free do Render, nos Estados Unidos (Oregon). Nela não é possível importar arquivos nem editar o extrato: há só a amostra fictícia e os lançamentos manuais isolados por sessão. Se precisar analisar um extrato real, rode o projeto localmente e não o exponha em instância compartilhada.

Versão resumida e navegável: [/privacidade.html](https://extrato-falado.onrender.com/privacidade.html). Registro das operações: [ROPA.md](ROPA.md). Impacto e riscos: [RIPD.md](RIPD.md). Plano de resposta: [INCIDENTES.md](INCIDENTES.md).

## 1. Quem controla os dados

O controlador, para fins da Lei nº 13.709/2018 (LGPD), é o mantenedor do projeto Extrato Falado (Elias Campos), responsável pelas decisões sobre o tratamento descrito neste aviso.

**Contato:** <eliascamposdev@gmail.com>. Use esse e-mail para pedir informação ou exercer seus direitos. Não publique extratos, CPFs, saldos ou dados de terceiros em issues do GitHub: elas são apenas para falhas técnicas.

Não há encarregado (DPO) designado e publicado nesta versão, nem identificação fiscal/endereço publicados. A publicação desses dados é pendência do controlador.

## 2. Dados que entram no tratamento

Não há cadastro de usuário, senha ou/login: a associação entre visitante e dados é feita por cookies anônimos. Ainda assim, os dados abaixo são pessoais e devem ser tratados como tal.

| Dado | De onde vem | Observação |
|---|---|---|
| Perguntas do chat | Texto digitado na interface | Limitadas a 300 caracteres; podem conter nomes ou outras informações pessoais |
| Lançamentos de CSV/OFX/PDF importados | Arquivo enviado pelo visitante | Descrições, estabelecimentos (`merchants`), saldos, datas e valores |
| Identificadores de conta | Conteúdo do arquivo | 4 dígitos no OFX; números mais completos em alguns PDFs |
| Dados de terceiros dentro das descrições | Arquivos importados | Nomes e CPFs de terceiros aparecem em descrições de Caixa, BB, PicPay e Santander |
| Lançamentos manuais | Formulário da interface | Descrição, tags, categoria, valor e data |
| Orçamentos, recorrências e overrides de categoria | Formulários da interface (fora da demo) | Regras criadas pelo usuário local |
| Registro de consentimento | `POST /api/consent` | `privacy`, `over18`, `shareNotice`, `llm` (booleano) e timestamp, gravados na tabela `consents` |
| Cookie `extrato_sid` | Navegador | Detalhes na seção 9 |
| Dados técnicos de acesso | Servidor/proxy | O endereço IP pode ser processado de forma transitória pelo proxy para entrega da página; o limite de requisições usa o hash da sessão, não o IP, e os eventos registrados em log não trazem dados pessoais |

Na **demo pública** (ativada por `PUBLIC_DEMO=1`) não é possível importar arquivos nem editar o extrato: há apenas a amostra fictícia e os lançamentos manuais isolados por sessão. Fora dela (desenvolvimento local e testes), a importação funciona e não aplica mascaramento, por isso não se deve importar extrato real em instâncias compartilhadas. O redutor de `[CPF]`, `[EMAIL]`, `[TELEFONE]` e `[NUMERO]` segue implementado como defesa em profundidade, mas não é alcançado na demo.

Os dados ficam em SQLite: `data/extrato.db` no uso local e `/data/extrato.db` no container. No plano free do Render, a instância não tem disco persistente: os dados importados são descartados quando ela é reciclada.

## 3. Finalidades

- Responder perguntas em português sobre o extrato, devolvendo o número apurado com o SQL, os parâmetros e o `QuerySpec` que o geraram.
- Importar e organizar CSV/OFX/PDF, deduplicar lançamentos, conferir saldos e calcular resumos, comparações, orçamentos e faturas (fora da demo).
- Registrar e manipular lançamentos manuais, mantendo os registros de cada visitante isolados na demo pública; recorrências e orçamentos ficam fora dela.
- Limitar abuso (taxa de consultas e requisições) e manter a disponibilidade e a integridade do serviço.
- Registrar consentimento e permitir a retirada e o exercício de direitos.

Não há analytics, telemetria, perfilamento comercial, publicidade nem fontes remotas de dados. O OCR com `tesseract.js` roda localmente; o modelo `por.traineddata` é baixado no build do Docker, não em cada visita.

## 4. Bases legais (art. 7 da LGPD)

| Tratamento | Base legal |
|---|---|
| Perguntas, lançamentos manuais e uso do LLM opcional na demo pública | Consentimento do titular (art. 7, I) |
| Prestação do serviço expressamente solicitado, quando não se aplica a demo pública | Execução de contrato ou procedimentos preliminares a pedido do titular (art. 7, V) |
| Segurança, integridade, limite de requisições e logs sem dados pessoais | Legítimo interesse do controlador (art. 7, IX) |
| Atendimento a direitos do titular e obrigações de segurança/incidentes | Cumprimento de obrigação legal ou regulatória (art. 7, II e art. 48 da LGPD) |

O consentimento é a base principal na demo pública. Se você não concordar, basta não consentir: a interface bloqueia os lançamentos manuais até que o consentimento seja registrado. A negativa não impede consultar a amostra fictícia, mas impede criar registros próprios.

## 5. Consentimento (arts. 8 e 9 da LGPD)

Um banner na interface apresenta este aviso e bloqueia os lançamentos manuais até o consentimento. Ele é registrado por:

```
POST /api/consent
{ "privacy": true, "over18": true, "shareNotice": true, "llm": boolean }
```

Os quatro campos são gravados com timestamp na tabela `consents` e associados à sessão. `llm` é uma autorização separada para o caso de `PLANNER=openai`: se você não autorizar, o planner permanece heurístico/offline para a sua sessão. `shareNotice` registra que você foi avisado de que a demo é compartilhada.

A retirada é feita por `DELETE /api/consent`, de forma gratuita e facilitada. Ela interrompe novos tratamentos baseados no consentimento; tratamentos já realizados permanecem regulares, e a eliminação dos dados pode ser pedida conforme a seção 10. O registro do consentimento é a prova de que a manifestação ocorreu (art. 8, §2º).

Se as condições de compartilhamento ou de uso do LLM mudarem, este aviso será atualizado e o consentimento precisará ser dado novamente.

## 6. Dados sensíveis por inferência (arts. 5, II e 11)

O projeto **não pede** dados sensíveis. Ainda assim, uma descrição bancária pode revelar, por inferência, convicção religiosa, opinião política, saúde, orientação sexual ou outros dados do art. 5, II da LGPD. Quando isso acontece, aplica-se o art. 11 (notadamente o §1º, que trata de dado que revela dado sensível e pode causar dano).

O banner não coleta uma autorização específica e destacada para dado sensível. Portanto: **não importe extratos cujas descrições possam revelar esse tipo de informação**. A redação automática cobre CPF, e-mail, telefone e sequências longas de dígitos - não cobre nomes nem o conteúdo da descrição.

## 7. Compartilhamento e transferência internacional

- **Render (hospedagem):** a demo pública roda no Render, região de Oregon, Estados Unidos, no plano free. Isso é uma transferência internacional de dados pessoais (art. 33 da LGPD).
- **Provedor de LLM opcional:** com `PLANNER=openai`, a pergunta e o contexto da consulta podem ser enviados a um provedor externo compatível com a API OpenAI. O `.env.example` traz exemplos com Groq, Gemini e OpenRouter. O uso por visitante depende do campo `llm` do consentimento. Por padrão, sem chave de API, o planner é heurístico e roda offline. Nenhum valor agregado passa pelo modelo: o SQLite é quem produz os números.
- **OCR:** `tesseract.js` processa PDFs-imagem localmente; o modelo de idioma é obtido no build da imagem Docker.
- Não há outros compartilhamentos previstos, nem analytics/telemetria.

A transferência para os Estados Unidos é amparada, como base contratual prevista na LGPD, pelas cláusulas-padrão da **Resolução CD/ANPD nº 19/2024** e por medidas complementares adequadas (art. 33, §2º). **A verificação, a formalização e a manutenção desses instrumentos com a Render e com eventuais provedores de LLM são de responsabilidade do controlador**; este aviso não afirma que já estejam assinados. A lista das entidades com as quais houve compartilhamento pode ser pedida pelo e-mail de contato (art. 18, VII).

## 8. Retenção e eliminação (arts. 15 e 16)

| Dado | Prazo |
|---|---|
| Lançamentos manuais e consentimentos da sessão na demo | 30 dias por padrão (`RETENTION_DAYS`), com exclusão automática ao expirar |
| Orçamentos e recorrências, fora da demo | Até exclusão manual. Fora da demo não há purga automática por 30 dias |
| Cookie `extrato_sid` | 30 dias |
| Hash da sessão (`session_hash`, SHA-256 do cookie) | Enquanto a sessão estiver ativa, observado o prazo dos registros associados |
| Dados importados (transações, saldos, overrides etc.), apenas em instâncias com importação aberta | Até a instância ser reciclada ou até `POST /api/reset`. O modo padrão `imported` apaga só transações importadas; o modo `all` cobre todas as tabelas |
| Logs de eventos sem dados pessoais | Enquanto necessários à operação e à investigação de incidentes |

Em uma instância com `EXTRATO_DB` sob `/data` e sem `DATA_PERSISTENT=true`, o campo `ephemeral` do `/api/health` indica que o banco é tratado como efêmero. Para apagar imediatamente os dados da sua sessão, use `DELETE /api/me`. Em instâncias onde a importação está disponível, `POST /api/reset` apaga o conteúdo compartilhado.

A exclusão automática dos 30 dias roda apenas na demo e apenas em registros com `session_hash`. Fora da demo, inclusive no uso local com importação aberta, não há purga automática: orçamentos, recorrências, overrides e dados importados dependem de exclusão manual ou de `POST /api/reset`.

A retirada do consentimento não apaga, por si só, dados compartilhados de instâncias com importação habilitada. Nesse caso, solicite a exclusão pelo e-mail de contato.

## 9. Cookies

| Cookie | Função | Atributos | Duração |
|---|---|---|---|
| `extrato_sid` | Identificador anônimo da sessão na demo pública; isola lançamentos manuais de cada visitante. O servidor guarda apenas o SHA-256 desse valor (`session_hash`) | `HttpOnly`, `Secure` em HTTPS, `SameSite=Lax`, `Path=/` | 30 dias |

O `extrato_sid` não é usado para publicidade ou rastreamento entre sites. Fora da demo pública (uso local/testes), ele não é necessário.

## 10. Direitos do titular (art. 18) e como exercê-los

Você pode pedir: confirmação de tratamento (I), acesso aos dados (II), correção (III), anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares (IV), portabilidade (V), eliminação dos dados tratados com consentimento (VI), informação sobre compartilhamento (VII), informação sobre a negativa do consentimento (VIII) e revogação do consentimento (IX). Também é possível peticionar à ANPD (art. 18, §1º) e se opor a tratamento com base em hipótese de dispensa de consentimento, quando houver descumprimento da LGPD (art. 18, §2º).

Na demo pública, os caminhos diretos são:

| Direito | Como exercer |
|---|---|
| Acesso e portabilidade dos dados da sessão | `GET /api/me` (JSON com consentimento, manuais, recorrências e orçamentos da sessão; não existem dados importados nesse escopo) |
| Exclusão dos dados da sessão | `DELETE /api/me` |
| Revogação do consentimento | `DELETE /api/consent` |
| Exclusão de todo o conteúdo da instância | Solicitar ao controlador; `POST /api/reset` fica disponível fora da demo |
| Correção | Editar o lançamento manual na interface; orçamentos, recorrências e reclassificação de categorias ficam fora da demo |
| Demais direitos e dúvidas | <eliascamposdev@gmail.com> (seção 1) |

O atendimento é gratuito. Quando a solicitação não puder ser atendida de imediato, o controlador informará o motivo. Dados de instâncias com importação aberta não são devolvidos por `/api/me` porque não são isolados por sessão; para cópia ou exclusão deles, use o e-mail de contato.

## 11. Segurança (art. 46)

Medidas adotadas: SQL parametrizado (a pergunta nunca entra na string SQL), bloqueio de importação/edição na demo, redutor de CPF/e-mail/telefone/números longos mantido como defesa em profundidade, cookies `HttpOnly` com `Secure` em HTTPS e `SameSite=Lax`, hashing SHA-256 de cookies, limites de tamanho de corpo, verificações de `Content-Type`, `Origin` e `Host` na API local, cabeçalhos de segurança nas respostas, isolamento de lançamentos manuais por sessão e rate limit em memória na demo (30 consultas/min e 120 requisições/min por hash de sessão). Eventos sem dados pessoais são registrados em log.

Em `/api/health`, a demo pública omite contagens, contas e fontes, traz `publicDemo: true` e calcula `ephemeral` conforme a configuração do banco. Fora da demo, o endpoint conserva as informações de estado que a interface local usa.

**Riscos residuais:** os PDFs exportados replicam descrições, SQL, parâmetros e `QuerySpec`; mensagens de erro de importação podem ecoar saldos e entradas inválidas. Não compartilhe esses arquivos ou mensagens com terceiros. Em instâncias com importação aberta, nomes de terceiros em descrições podem permanecer visíveis. Nenhum sistema é totalmente seguro: incidentes são tratados conforme o [runbook](INCIDENTES.md).

## 12. Incidentes (art. 48)

Se houver vazamento, uso indevido ou perda de dados, o controlador adotará as medidas técnico-administrativas cabíveis, registrará o ocorrido sem incluir dados pessoais nas evidências e comunicará a ANPD e os titulares afetados **conforme o prazo vigente da ANPD**, com as informações exigidas pela regulamentação. O procedimento está em [INCIDENTES.md](INCIDENTES.md). Comunique qualquer suspeita pelo e-mail da seção 1.

## 13. Crianças e adolescentes (art. 14)

O consentimento exige a declaração `over18: true`: a demo não é dirigida a menores de 18 anos. O tratamento de dados de crianças e adolescentes deve observar seu melhor interesse e, no caso de crianças, o consentimento específico e destacado de pelo menos um dos pais ou do responsável legal. Se você identificou dados de menor nesta demo, peça a exclusão pelo e-mail de contato.

## 14. Decisões automatizadas (art. 20)

As respostas vêm de um planner heurístico offline (padrão) ou, se autorizado, de um LLM usado apenas para traduzir a pergunta em `QuerySpec`; a categorização usa regras e kNN TF-IDF. O SQLite produz os números, e a interface mostra SQL, parâmetros e `QuerySpec` para conferência. Esses mecanismos **não definem perfil pessoal, profissional, de consumo ou de crédito**, nem produzem efeitos jurídicos sobre o titular. Ainda assim, qualquer revisão pode ser solicitada pelo e-mail de contato, com explicação dos critérios e procedimentos usados (art. 20, §1º).

## 15. Alterações deste aviso

Mudanças de finalidade, de compartilhamento ou de bases legais serão refletidas aqui com nova data de atualização e, quando o consentimento for necessário, pedidas novamente antes do tratamento. O histórico do projeto fica no repositório <https://github.com/EliasCamposDEV/extrato-falado>.
