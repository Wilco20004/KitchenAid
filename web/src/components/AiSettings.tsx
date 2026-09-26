import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { BudgetProStatus } from '../types';
import Icon from './Icon';

const HOST_KEY = 'kitchenaid.mcpHost';

function savedHost(): string {
  try {
    return localStorage.getItem(HOST_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * navigator.clipboard only exists over https/localhost. Over plain http the
 * text is selected with the old execCommand fallback, and if even that is
 * refused the box stays selected with a "press Ctrl+C" hint.
 */
function CopyBox({ text, rows = 2 }: { text: string; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setState('copied');
        return;
      }
    } catch {
      /* fall through */
    }
    ref.current?.select();
    const ok = document.execCommand?.('copy');
    setState(ok ? 'copied' : 'select');
  }

  return (
    <div className="copy-box">
      <textarea ref={ref} readOnly rows={rows} value={text} onFocus={(e) => e.target.select()} spellCheck={false} />
      <button type="button" className="button secondary small" onClick={copy}>
        <Icon name="copy" size={14} /> {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      {state === 'select' && <span className="muted tiny">Selected — press Ctrl+C (or long-press → Copy).</span>}
    </div>
  );
}

export function AiAssistants() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState(() => savedHost() || (window.location.port === '8096' ? window.location.hostname : ''));
  const [tool, setTool] = useState<'claude-code' | 'claude-desktop' | 'gemini'>('claude-code');

  useEffect(() => {
    api
      .getMcpToken()
      .then((r) => setToken(r.token))
      .catch((e) => setError(e.message));
  }, []);

  function changeHost(v: string) {
    setHost(v);
    try {
      localStorage.setItem(HOST_KEY, v);
    } catch {
      /* per-browser convenience only */
    }
  }

  async function regenerate() {
    if (!confirm('Make a new token? Anything set up with the old one stops working until you paste the new one.')) return;
    setToken((await api.regenerateMcpToken()).token);
  }

  const url = `http://${host.trim() || '<your-HA-IP>'}:8096/mcp`;
  const t = token ?? '<token>';
  const snippets = {
    'claude-code': `claude mcp add --transport http kitchenaid ${url} --header "Authorization: Bearer ${t}"`,
    'claude-desktop': JSON.stringify(
      { mcpServers: { kitchenaid: { command: 'npx', args: ['-y', 'mcp-remote', url, '--allow-http', '--header', `Authorization: Bearer ${t}`] } } },
      null,
      2
    ),
    gemini: JSON.stringify({ mcpServers: { kitchenaid: { httpUrl: url, headers: { Authorization: `Bearer ${t}` } } } }, null, 2),
  };
  const where = {
    'claude-code': 'Run this once in a terminal:',
    'claude-desktop': 'Add to claude_desktop_config.json (Settings → Developer → Edit config), then restart Claude Desktop:',
    gemini: 'Add to ~/.gemini/settings.json (merge into any existing "mcpServers"):',
  };

  return (
    <section className="panel" id="ai">
      <h2>AI assistants (MCP)</h2>
      <p className="muted small">
        Let Claude or Gemini check prices, price your shopping list, cost recipes, and read your recipes, meal plan, list and pantry.
        Try: <em>“What's the cheapest place to buy this week's shopping list?”</em> or <em>“What does the bobotie cost per serving?”</em>
      </p>
      {error ? (
        <p className="notice warn small">{error}</p>
      ) : (
        <>
          <label className="field">
            <span className="label">Home Assistant address (as seen from the computer running the AI)</span>
            <input value={host} onChange={(e) => changeHost(e.target.value)} placeholder="e.g. 10.1.1.3" />
          </label>
          <div className="segmented">
            <button type="button" className={tool === 'claude-code' ? 'active' : ''} onClick={() => setTool('claude-code')}>
              Claude Code
            </button>
            <button type="button" className={tool === 'claude-desktop' ? 'active' : ''} onClick={() => setTool('claude-desktop')}>
              Claude Desktop
            </button>
            <button type="button" className={tool === 'gemini' ? 'active' : ''} onClick={() => setTool('gemini')}>
              Gemini CLI
            </button>
          </div>
          <p className="small">{where[tool]}</p>
          <CopyBox text={snippets[tool]} rows={tool === 'claude-code' ? 3 : 9} />
          <div className="row-between small">
            <span className="muted">The token lets anything on your network use these tools — keep it private.</span>
            <button type="button" className="link small" onClick={regenerate}>
              New token
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function BudgetProSettings() {
  const [status, setStatus] = useState<BudgetProStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => api.budgetProStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    load();
  }, []);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.syncBudgetPro();
      setMessage(`${r.receipts} new slip(s), ${r.items} item(s) into the pantry, ${r.ticked} ticked off the list.`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      load();
    }
  }

  return (
    <section className="panel" id="budgetpro">
      <h2>BudgetPro</h2>
      <p className="muted small">
        Grocery slips logged in BudgetPro are checked every 30 minutes: what you bought goes into the pantry with the price you paid
        (so recipes can be costed), and matching shopping-list items are ticked off.
      </p>
      {status?.configured ? (
        <>
          <p className="small">
            Connected to <code>{status.url}</code> · categories: {status.categories.join(', ')}
            <br />
            <span className="muted">
              {status.lastSync ? `Last checked ${new Date(status.lastSync).toLocaleString()}` : 'Not checked yet'}
              {status.lastResult && ` · last run: ${status.lastResult.receipts} slip(s), ${status.lastResult.items} item(s)`}
            </span>
          </p>
          {status.lastError && <p className="error small">{status.lastError}</p>}
          {message && <p className="notice small">{message}</p>}
          <button type="button" className="button secondary small" onClick={sync} disabled={busy}>
            <Icon name="refresh" size={14} /> {busy ? 'Checking…' : 'Check now'}
          </button>
        </>
      ) : (
        <p className="notice small">
          Not connected. In Home Assistant open <em>Settings → Add-ons → KitchenAid → Configuration</em> and set{' '}
          <code>budgetpro_url</code> (BudgetPro's own port, e.g. <code>http://10.1.1.3:8097</code>) and <code>budgetpro_token</code> (from
          BudgetPro → Settings → API & AI access), then restart KitchenAid.
        </p>
      )}
    </section>
  );
}
