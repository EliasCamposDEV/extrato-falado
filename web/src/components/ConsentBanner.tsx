import { useState } from 'react';

interface Props {
  retentionDays: number;
  onAccept: (llm: boolean) => void;
  onLater: () => void;
  busy?: boolean;
}

/** Aviso exigido antes de qualquer escrita na demo pública. */
export function ConsentBanner({ retentionDays, onAccept, onLater, busy = false }: Props) {
  const [privacy, setPrivacy] = useState(false);
  const [over18, setOver18] = useState(false);
  const [share, setShare] = useState(false);
  const [llm, setLlm] = useState(false);
  const ready = privacy && over18 && share && !busy;

  return (
    <section className="consent-banner" aria-label="Aviso de privacidade">
      <div className="consent-inner">
        <div className="consent-copy">
          <p className="consent-kicker">PRIVACIDADE · LGPD</p>
          <h2>Antes de registrar dados</h2>
          <p>
            Esta é uma demonstração compartilhada. Seus lançamentos manuais ficam
            identificados apenas pelo seu navegador e são apagados após {retentionDays} dias.
            Não importe extrato real: nomes de terceiros podem aparecer nas descrições.
            Saiba mais em <a href="/privacidade.html" target="_blank" rel="noopener">Aviso de privacidade</a>.
          </p>
        </div>
        <form
          className="consent-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onAccept(llm);
          }}
        >
          <label>
            <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
            <span>Li e aceito o <a href="/privacidade.html" target="_blank" rel="noopener">Aviso de privacidade</a>.</span>
          </label>
          <label>
            <input type="checkbox" checked={over18} onChange={(e) => setOver18(e.target.checked)} />
            <span>Tenho 18 anos ou mais.</span>
          </label>
          <label>
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>Entendo que o extrato de exemplo é compartilhado e que a demo fica no Render (EUA).</span>
          </label>
          <label className="consent-optional">
            <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} />
            <span>Autorizo enviar minhas perguntas a um modelo externo, se essa opção estiver ativa no servidor.</span>
          </label>
          <div className="consent-actions">
            <button type="submit" disabled={!ready}>{busy ? 'Salvando…' : 'Aceitar e continuar'}</button>
            <button type="button" className="consent-later" onClick={onLater}>Só navegar</button>
          </div>
        </form>
      </div>
    </section>
  );
}
