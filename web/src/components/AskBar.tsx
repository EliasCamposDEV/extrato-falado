import { useId, type RefObject } from 'react';

interface AskBarProps {
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (question: string) => void;
  loading: boolean;
  disabled: boolean;
  suggestions: string[];
  followUps?: string[];
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function AskBar({ draft, onDraft, onSubmit, loading, disabled, suggestions, followUps = [], inputRef }: AskBarProps) {
  const inputId = useId();
  const canSend = draft.trim().length > 1 && !loading && !disabled;

  return (
    <div className="askbar">
      <form
        className="ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          onSubmit(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Pergunta sobre o extrato
        </label>
        <span className="ask-pen" aria-hidden="true">
          ›
        </span>
        <input
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="Pergunte sobre o extrato…"
          autoComplete="off"
          spellCheck={false}
          maxLength={300}
          disabled={disabled}
        />
        <button type="submit" className="ask-go" disabled={!canSend}>
          {loading ? 'Conferindo…' : 'Consultar'}
        </button>
      </form>

      <div className="ask-foot">
        <p className="ask-hint">
          Enter consulta · o valor vem do SQLite, nunca do modelo
        </p>
        <div className="chips" role="group" aria-label="Perguntas de exemplo">
          {suggestions.map((question) => (
            <button
              key={question}
              type="button"
              className="chip"
              onClick={() => onSubmit(question)}
              disabled={loading || disabled}
            >
              {question}
            </button>
          ))}
        </div>
        {followUps.length > 0 && (
          <div className="chips chips-next" role="group" aria-label="Continuar a consulta">
            <span className="chips-label" aria-hidden="true">
              continuar
            </span>
            {followUps.map((question) => (
              <button
                key={question}
                type="button"
                className="chip chip-next"
                onClick={() => onSubmit(question)}
                disabled={loading || disabled}
              >
                {question}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
