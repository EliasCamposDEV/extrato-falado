const STEPS = [
  {
    title: 'A pergunta vira filtro',
    body:
      'O planner devolve um QuerySpec: intenção, período, direção, categoria, texto e conta. Ele recebe a pergunta e a data de hoje, nunca um valor, e não escreve SQL.',
  },
  {
    title: 'O filtro é conferido',
    body:
      'Nada roda antes da validação: campo desconhecido, data torta ou limite absurdo viram erro com mensagem acionável. Com LLM, esse erro volta como contexto e o modelo tem uma segunda chance. Se a pergunta cita um nome que está no extrato, o servidor garante o filtro mesmo que o planner esqueça.',
  },
  {
    title: 'Vira SQL parametrizado',
    body:
      'O compilador põe cada valor no lugar de um ?: período, categoria, texto e limite viajam como parâmetros do prepared statement. Nenhum trecho da pergunta entra na string, e dinheiro é inteiro, em centavos.',
  },
  {
    title: 'O SQLite soma',
    body:
      'Uma agregação, uma passada no banco. O total de um top 5 sai de SUM(...) OVER (), então é o do recorte inteiro, não a soma das cinco linhas que aparecem na tela.',
  },
  {
    title: 'A resposta é montada',
    body:
      'Um template em português formata o número que voltou do banco. O texto é previsível, testável e não pode inventar valor: o que o SQL não devolveu não aparece.',
  },
];

export function Mechanism() {
  return (
    <section id="como-funciona" className="section mechanism" aria-labelledby="mechanism-title">
      <div className="section-head">
        <h2 id="mechanism-title">Como o número é apurado</h2>
        <p>o mecanismo, sem caixa-preta</p>
      </div>

      <p className="chain">
        <span>pergunta</span>
        <i aria-hidden="true">→</i>
        <span>QuerySpec</span>
        <i aria-hidden="true">→</i>
        <span>SQL parametrizado</span>
        <i aria-hidden="true">→</i>
        <span>SQLite</span>
        <i aria-hidden="true">→</i>
        <span className="is-end">número</span>
      </p>

      <div className="steps">
        {STEPS.map((step, index) => (
          <div className="step" key={step.title}>
            <span className="step-number">{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        ))}
      </div>

      <p className="mechanism-note">
        O planner heurístico roda offline, sem chave de API: é o padrão e serve de baseline, 12/12 casos
        no eval, tanto no plano quanto na resposta. Com <code>PLANNER=openai</code> o LLM entra no mesmo
        validador, aceita um provedor secundário e cai sozinho no heurístico se os dois falharem.
        Continuações do tipo “e no mês anterior?” não passam pelo modelo: são resolvidas por heurística
        sobre a spec anterior, em cima do período da pergunta, não do relógio.
      </p>

      <p className="mechanism-note">
        O número não passa pelo modelo, mas passa por conferência na entrada: importar um PDF confere a
        soma contra o saldo que o extrato declara, e a conta escrita no arquivo vence o nome dele.
        Reimportar não duplica, a chave é o <code>fitid</code> do banco quando existe, senão conta, data,
        valor e estabelecimento.
      </p>

      <p className="mechanism-note">
        Cada resposta leva junto o SQL, os parâmetros e a spec. A folha de prova repete esse recorte, e o
        PDF dela reusa a spec que estava na tela em vez de replanejar: o papel prova o número que você viu.
      </p>
    </section>
  );
}
