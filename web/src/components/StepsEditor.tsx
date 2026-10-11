import { KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { RefIngredient, stepParts } from '../utils/steps';

// The method, one step per line, with ingredient amounts written as {{flour}}.
// Typing "{{" offers the ingredients' short names; the preview underneath
// shows the steps as the recipe page will, with unknown names in red.

export default function StepsEditor({
  value,
  onChange,
  ingredients,
}: {
  value: string;
  onChange: (text: string) => void;
  ingredients: (RefIngredient & { ref: string })[];
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Where the caret goes once React has put the new text in (it would jump to the end).
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAfter.current === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  });

  const options = query === null ? [] : ingredients.filter((i) => i.ref.includes(query) || i.name.toLowerCase().includes(query)).slice(0, 8);

  function refresh(text: string, caret: number) {
    const m = text.slice(0, caret).match(/\{\{\s*([a-z0-9-]*)$/i);
    setQuery(m ? m[1].toLowerCase() : null);
    setActive(0);
  }

  /** Puts {{ref}} where the caret is (replacing a half-typed "{{fl"). */
  function insert(ref: string) {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret);
    const m = before.match(/\{\{\s*([a-z0-9-]*)$/i);
    const start = m ? caret - m[0].length : caret;
    const after = value.slice(caret).replace(/^[a-z0-9-]*\s*\}\}/i, '');
    const token = `{{${ref}}}`;
    caretAfter.current = start + token.length;
    onChange(value.slice(0, start) + token + after);
    setQuery(null);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!options.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insert(options[active].ref);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery(null);
    }
  }

  const lines = value.split('\n').filter((l) => l.trim() && !/^[^\d].{0,48}:$/.test(l.trim()));
  const usesRefs = /\{\{/.test(value);

  return (
    <div className="steps-editor">
      <div className="steps-input">
        <textarea
          ref={area}
          rows={14}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            refresh(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKey}
          onClick={(e) => refresh(value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          placeholder={'Heat the oven to 180 °C.\nSift {{flour}} and {{salt}} into a bowl.\nAdd the mince and brown.'}
        />
        {options.length > 0 && (
          <ul className="ref-menu" role="listbox">
            {options.map((o, i) => (
              <li key={o.ref} role="option" aria-selected={i === active}>
                <button type="button" className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(o.ref)}>
                  <code>{`{{${o.ref}}}`}</code> <span className="muted">{o.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {ingredients.length > 0 && (
        <div className="ref-chips">
          <span className="hint">Insert an amount:</span>
          {ingredients.map((i) => (
            <button key={i.ref} type="button" className="chip small" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(i.ref)} title={i.name}>
              {i.ref}
            </button>
          ))}
        </div>
      )}
      {usesRefs && lines.length > 0 && (
        <details className="steps-preview" open>
          <summary className="hint">Preview</summary>
          <ol>
            {lines.map((l, n) => (
              <li key={n}>
                {stepParts(l.replace(/^\d+[.)]\s+/, ''), ingredients).map((p, k) =>
                  'value' in p ? (
                    <mark key={k} className="amount">
                      {p.value}
                    </mark>
                  ) : 'missing' in p ? (
                    <mark key={k} className="amount missing" title="No ingredient has this short name">
                      {p.missing}
                    </mark>
                  ) : (
                    <span key={k}>{p.text}</span>
                  )
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
