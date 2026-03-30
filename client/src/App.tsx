import { useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useAgent, ChatMessage, ToolCallEvent } from "./hooks/useAgent";

// ─── Icons (inline SVG components) ────────────────

const IconSend = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const IconStop = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
);
const IconSlack = () => <span style={{fontSize:"13px"}}>💬</span>;
const IconNotion = () => <span style={{fontSize:"13px"}}>📄</span>;
const IconDiscord = () => <span style={{fontSize:"13px"}}>🎮</span>;
const IconAuth = () => <span style={{fontSize:"13px"}}>🔐</span>;
const IconCheck = () => <span style={{fontSize:"11px", color:"#28c840"}}>✓</span>;
const IconX = () => <span style={{fontSize:"11px", color:"#ff5f57"}}>✗</span>;
const IconSpin = () => <span className="spin" style={{display:"inline-block",fontSize:"12px"}}>⟳</span>;

// ─── Auth Gate ─────────────────────────────────────

function AuthGate() {
  const { loginWithRedirect } = useAuth0();
  return (
    <div className="auth-gate">
      <div className="gate-card">
        <div className="gate-logo">Dele<span>gate</span></div>
        <p className="gate-sub">Your AI agent for Slack, Notion, and Discord,<br/>secured by Auth0 Token Vault.</p>
        <button className="gate-btn" onClick={() => loginWithRedirect()}>
          Sign in with Auth0
        </button>
        <div className="gate-note">
          <IconAuth /> Auth0 Token Vault keeps your credentials encrypted.<br/>
          The agent only receives scoped, short-lived tokens.
        </div>
      </div>
    </div>
  );
}

// ─── Tool Call Card ────────────────────────────────

function ToolCard({ tc }: { tc: ToolCallEvent }) {
  const [open, setOpen] = useState(false);
  const service = tc.tool.startsWith("slack")
    ? "slack"
    : tc.tool.startsWith("discord")
      ? "discord"
      : "notion";

  const statusIcon =
    tc.status === "pending" ? <IconSpin /> :
    tc.status === "done"    ? <IconCheck /> :
                              <IconX />;

  const serviceIcon =
    service === "slack" ? <IconSlack /> : service === "discord" ? <IconDiscord /> : <IconNotion />;

  return (
    <div className={`tool-card tool-${tc.status}`}>
      <div className="tool-card-header" onClick={() => setOpen(o => !o)}>
        <span className="tc-service">{serviceIcon}</span>
        <span className="tc-name">{tc.tool.replace(/_/g," ")}</span>
        <span className="tc-status">{statusIcon}</span>
        <span className="tc-toggle">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="tool-card-body">
          <div className="tc-section-label">Input</div>
          <pre className="tc-json">{JSON.stringify(tc.input, null, 2)}</pre>
          {tc.result !== undefined && (
            <>
              <div className="tc-section-label" style={{marginTop:"8px"}}>Result</div>
              <pre className="tc-json tc-result">{JSON.stringify(tc.result, null, 2).slice(0, 800)}{JSON.stringify(tc.result).length > 800 ? "\n…" : ""}</pre>
            </>
          )}
          {tc.error && (
            <>
              <div className="tc-section-label" style={{marginTop:"8px", color:"var(--danger)"}}>Error</div>
              <pre className="tc-json tc-error">{tc.error}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Auth Required Prompt ──────────────────────────

function AuthPrompt({ connection, onDismiss }: { connection: string; onDismiss: () => void }) {
  const { loginWithRedirect } = useAuth0();
  const Icon = connection === "slack" ? IconSlack : connection === "discord" ? IconDiscord : IconNotion;
  const name = connection.charAt(0).toUpperCase() + connection.slice(1);

  return (
    <div className="auth-prompt">
      <div className="ap-title"><IconAuth /> Auth0 Token Vault — Consent Required</div>
      <p className="ap-body">
        To use <strong>{name}</strong>, your vault needs a token.
        Auth0 will handle the OAuth flow — your credentials stay encrypted in the vault.
        Delegate only receives a scoped, time-limited access token.
      </p>
      <div className="ap-btns">
        <button className="btn-approve" onClick={() => loginWithRedirect({
          authorizationParams: { connection, scope: "openid profile email" }
        })}>
          Authorize {name} via Auth0
        </button>
        <button className="btn-cancel" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────

function MessageBubble({ msg, onDismissAuth }: { msg: ChatMessage; onDismissAuth: () => void }) {
  const isUser = msg.role === "user";

  return (
    <div className={`msg-row ${isUser ? "msg-user" : "msg-agent"}`}>
      <div className={`msg-avatar ${isUser ? "av-user" : "av-agent"}`}>
        {isUser ? "You" : "D"}
      </div>
      <div className="msg-content">
        <div className="msg-sender">
          {isUser ? "You" : "Delegate · Agent"}
          <span className="msg-time">
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="tool-calls">
            {msg.toolCalls.map((tc, i) => (
              <ToolCard key={i} tc={tc} />
            ))}
          </div>
        )}

        {msg.content && (
          <div className={`bubble ${isUser ? "bubble-user" : "bubble-agent"}`}>
            {msg.content.split("\n").map((line, i) => (
              <span key={i}>{line}{i < msg.content.split("\n").length - 1 && <br/>}</span>
            ))}
          </div>
        )}

        {!msg.content && !isUser && msg.toolCalls?.length === 0 && (
          <div className="bubble bubble-agent typing">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}

        {msg.authRequired && (
          <AuthPrompt connection={msg.authRequired.connection} onDismiss={onDismissAuth} />
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────

function Sidebar({ connections, onClear }: {
  connections: { connection: string; connected: boolean }[];
  onClear: () => void;
}) {
  const { user, logout } = useAuth0();
  const slackConn = connections.find(c => c.connection === "slack");
  const notionConn = connections.find(c => c.connection === "notion");
  const discordConn = connections.find(c => c.connection === "discord");

  const perms = [
    { label: "Read Slack messages", granted: true },
    { label: "Post to Slack", granted: true },
    { label: "Read Notion pages", granted: !!notionConn?.connected },
    { label: "Create Notion pages", granted: !!notionConn?.connected },
    { label: "Read Discord messages", granted: !!discordConn?.connected },
    { label: "Post to Discord", granted: !!discordConn?.connected },
    { label: "Delete Slack messages", granted: false },
    { label: "Share Notion externally", granted: false },
  ];

  return (
    <aside className="sidebar">
      <div className="sb-section">
        <div className="sb-label">Navigation</div>
        <div className="nav-item active"><span>✦</span> Agent Chat</div>
        <div className="nav-item" onClick={onClear}><span>⊘</span> Clear Chat</div>
        <div className="nav-item"><span>◎</span> Activity Log</div>
        <div className="nav-item"><span>⚙</span> Settings</div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Connections</div>

        <div className="conn-row">
          <div className="conn-icon-wrap slack-bg"><IconSlack /></div>
          <div className="conn-info">
            <div className="conn-name">Slack</div>
            <div className="conn-ws">workspace: acme-co</div>
          </div>
          <span className={`conn-badge ${slackConn?.connected ? "badge-ok" : "badge-warn"}`}>
            {slackConn?.connected ? "Connected" : "Connect ↗"}
          </span>
        </div>

        <div className="conn-row">
          <div className="conn-icon-wrap notion-bg"><IconNotion /></div>
          <div className="conn-info">
            <div className="conn-name">Notion</div>
            <div className="conn-ws">workspace: personal</div>
          </div>
          <span className={`conn-badge ${notionConn?.connected ? "badge-ok" : "badge-warn"}`}>
            {notionConn?.connected ? "Connected" : "Connect ↗"}
          </span>
        </div>

        <div className="conn-row">
          <div className="conn-icon-wrap discord-bg"><IconDiscord /></div>
          <div className="conn-info">
            <div className="conn-name">Discord</div>
            <div className="conn-ws">workspace: servers</div>
          </div>
          <span className={`conn-badge ${discordConn?.connected ? "badge-ok" : "badge-warn"}`}>
            {discordConn?.connected ? "Connected" : "Connect ↗"}
          </span>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Granted Permissions</div>
        {perms.map((p, i) => (
          <div className="perm-row" key={i}>
            {p.granted ? <IconCheck /> : <IconX />}
            <span className={p.granted ? "perm-ok" : "perm-no"}>{p.label}</span>
          </div>
        ))}
      </div>

      <div className="sb-footer">
        <div className="vault-badge">
          <span className="vault-dot" />
          Auth0 Token Vault · Active
        </div>
        {user && (
          <button className="logout-btn" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── Main App ──────────────────────────────────────

const HINTS = [
  "Summarize #eng-alerts from last 24h",
  "Draft my standup from Slack activity",
  "Create a Notion page with today's digest",
  "What's urgent in #product this week?",
  "Post a status update to #general",
];

export default function App() {
  const { isLoading, isAuthenticated, user } = useAuth0();
  const { messages, isStreaming, connections, sendMessage, fetchConnections, stop, clearMessages } = useAgent();
  const [input, setInput] = useState("");
  const [dismissedAuth, setDismissedAuth] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isAuthenticated) fetchConnections();
  }, [isAuthenticated, fetchConnections]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!isAuthenticated) return <AuthGate />;

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMessage(text);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  return (
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <div className="logo">Dele<span>gate</span></div>
        <div className="vault-status">
          <span className="vault-dot" />
          Auth0 Token Vault · Secured
        </div>
        <div className="user-pill">
          <div className="user-avatar">{user?.name?.[0] ?? "U"}</div>
          <span>{user?.name ?? user?.email}</span>
        </div>
      </header>

      <div className="body-row">
        <Sidebar connections={connections} onClear={clearMessages} />

        <main className="main">
          <div className="chat-scroll">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="es-mark">✦</div>
                <div className="es-title">What should I handle?</div>
                <div className="es-sub">Ask me to read Slack, summarize threads, or create Notion pages.</div>
                <div className="es-hints">
                  {HINTS.map(h => (
                    <button key={h} className="hint-chip" onClick={() => sendMessage(h)}>{h}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onDismissAuth={() => setDismissedAuth(s => new Set([...s, msg.id]))}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="input-area">
            <div className="input-wrap">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={autoResize}
                onKeyDown={handleKey}
                placeholder="Ask Delegate to do something…"
                rows={1}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button className="send-btn stop-btn" onClick={stop}><IconStop /></button>
              ) : (
                <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
                  <IconSend />
                </button>
              )}
            </div>
            <div className="input-footer">
              Delegate can read/post Slack · read/write Notion · powered by Claude + Auth0
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
