import { useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useAgent, ChatMessage, ToolCallEvent } from "./hooks/useAgent";

const viteEnv = ((import.meta as any)?.env ?? {}) as Record<string, string | undefined>;
const DISCORD_INSTALL_URL = "https://discord.com/oauth2/authorize?client_id=1488419745194836011&scope=bot%20applications.commands&permissions=66560";
const SLACK_INSTALL_URL = "https://api.slack.com/apps";

const AUTH0_CONNECTIONS = {
  slack: viteEnv.VITE_AUTH0_CONNECTION_SLACK || "sign-in-with-slack",
  discord: viteEnv.VITE_AUTH0_CONNECTION_DISCORD || "discord",
} as const;

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
        <p className="gate-sub">Your AI agent for Slack and Discord,<br/>secured by Auth0 Token Vault.</p>
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
    : "discord";

  const statusIcon =
    tc.status === "pending" ? <IconSpin /> :
    tc.status === "done"    ? <IconCheck /> :
                              <IconX />;

  const serviceIcon = service === "slack" ? <IconSlack /> : <IconDiscord />;

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

function AuthPrompt({ connection, onDismiss, connections }: { connection: string; onDismiss: () => void; connections: { connection: string; connected: boolean }[] }) {
  const { loginWithRedirect } = useAuth0();
  const Icon = connection === "slack" ? IconSlack : IconDiscord;
  const name = connection.charAt(0).toUpperCase() + connection.slice(1);
  const auth0ConnectionName =
    connection === "slack"
      ? AUTH0_CONNECTIONS.slack
      : AUTH0_CONNECTIONS.discord;

  // Check if user has another service connected
  const connectedOther = connections.find(c => c.connected && c.connection !== connection);
  const hasOtherConnected = !!connectedOther;

  return (
    <div className="auth-prompt">
      <div className="ap-title"><IconAuth /> Auth0 Token Vault — {hasOtherConnected ? "Switch Service" : "Connect Service"}</div>
      <p className="ap-body">
        {hasOtherConnected ? (
          <>
            You're currently connected to <strong>{connectedOther!.connection}</strong>.
            To use <strong>{name}</strong>, I'll switch your vault token.
            Auth0 will handle the OAuth flow — your credentials stay encrypted.
            Delegate only receives a scoped, time-limited access token.
          </>
        ) : (
          <>
            To use <strong>{name}</strong>, your vault needs a token.
            Auth0 will handle the OAuth flow — your credentials stay encrypted in the vault.
            Delegate only receives a scoped, time-limited access token.
          </>
        )}
        {connection === "discord" && (
          <>
            <br />
            <br />
            If Delegate is not yet installed in your Discord server, install it first.
          </>
        )}
      </p>
      <div className="ap-btns">
        {connection === "discord" && (
          <button
            className="btn-cancel"
            onClick={() => window.open(DISCORD_INSTALL_URL, "_blank", "noopener,noreferrer")}
          >
            Install Delegate to Discord
          </button>
        )}
        <button
          className="btn-approve"
          onClick={() => {
            sessionStorage.setItem("delegate:pending-connection", connection);
            loginWithRedirect({
              authorizationParams: { connection: auth0ConnectionName, scope: "openid profile email" },
            });
          }}
        >
          {hasOtherConnected ? `Switch to ${name}` : `Authorize ${name}`}
        </button>
        <button className="btn-cancel" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .filter(Boolean);

  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={idx} className="msg-inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderMessageContent(content: string) {
  const lines = content.split("\n");
  const nodes: JSX.Element[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="msg-list">
        {bullets.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushBullets();
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushBullets();
      const level = heading[1].length;
      const text = heading[2];
      const className = level === 1 ? "msg-h1" : level === 2 ? "msg-h2" : "msg-h3";
      nodes.push(
        <div key={`h-${nodes.length}`} className={className}>
          {renderInlineMarkdown(text)}
        </div>
      );
      return;
    }

    const bullet = line.match(/^[-•]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }

    const numbered = line.match(/^\d+[\.)]\s+(.+)$/);
    if (numbered) {
      bullets.push(numbered[1]);
      return;
    }

    flushBullets();
    nodes.push(
      <p key={`p-${nodes.length}`} className="msg-p">
        {renderInlineMarkdown(line)}
      </p>
    );
  });

  flushBullets();
  return nodes;
}

// ─── Message Bubble ────────────────────────────────

function MessageBubble({ msg, onDismissAuth, connections }: { msg: ChatMessage; onDismissAuth: () => void; connections: { connection: string; connected: boolean }[] }) {
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
            {(msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
            {renderMessageContent(msg.content)}
          </div>
        )}

        {!msg.content && !isUser && msg.toolCalls?.length === 0 && (
          <div className="bubble bubble-agent typing">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}

        {msg.authRequired && (
          <AuthPrompt connection={msg.authRequired.connection} onDismiss={onDismissAuth} connections={connections || []} />
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────

function Sidebar({ connections, context, setContext, onClear, onClose }: {
  connections: { connection: string; connected: boolean }[];
  context: { service?: "slack" | "discord"; workspaceId?: string; channelId?: string };
  setContext: (ctx: { service?: "slack" | "discord"; workspaceId?: string; channelId?: string }) => void;
  onClear: () => void;
  onClose?: () => void;
}) {
  const { user, logout, loginWithRedirect } = useAuth0();
  const slackConn = connections.find(c => c.connection === "slack");
  const discordConn = connections.find(c => c.connection === "discord");

  const startConnectionAuth = (connection: "slack" | "discord") => {
    const auth0ConnectionName =
      connection === "slack"
        ? AUTH0_CONNECTIONS.slack
        : AUTH0_CONNECTIONS.discord;

    sessionStorage.setItem("delegate:pending-connection", connection);

    loginWithRedirect({
      authorizationParams: { connection: auth0ConnectionName, scope: "openid profile email" },
    });
  };

  const perms = [
    { label: "Read Slack messages", granted: !!slackConn?.connected },
    { label: "Post to Slack", granted: !!slackConn?.connected },
    { label: "Read Discord messages", granted: !!discordConn?.connected },
    { label: "Post to Discord", granted: !!discordConn?.connected },
    { label: "Delete Slack messages", granted: false },
    { label: "Manage Discord roles", granted: false },
  ];

  return (
    <aside className="sidebar">
      {onClose && <button className="sb-close" onClick={onClose}>✕</button>}
      <div className="sb-section">
        <div className="sb-label">Navigation</div>
        <div className="nav-item active"><span>✦</span> Agent Chat</div>
        <div className="nav-item" onClick={onClear}><span>⊘</span> Clear Chat</div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Active Service</div>
        <div className="service-toggle-wrap">
          <button
            className={`service-toggle ${context?.service === "slack" ? "active" : ""}`}
            onClick={() => setContext({ ...context, service: "slack" })}
          >
            <IconSlack /> Slack
          </button>
          <button
            className={`service-toggle ${context?.service === "discord" ? "active" : ""}`}
            onClick={() => setContext({ ...context, service: "discord" })}
          >
            <IconDiscord /> Discord
          </button>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Connections</div>

        <div className="conn-row">
          <div className="conn-icon-wrap slack-bg"><IconSlack /></div>
          <div className="conn-info">
            <div className="conn-name">Slack</div>
            <div className="conn-ws">workspace: acme-co</div>
          </div>
          {!slackConn?.connected ? (
            <div className="conn-actions">
              <button
                type="button"
                className="conn-badge badge-warn"
                onClick={() => window.open(SLACK_INSTALL_URL, "_blank", "noopener,noreferrer")}
                title="Create/install Slack app"
              >
                Install ↗
              </button>
              <button
                type="button"
                className="conn-badge badge-warn"
                onClick={() => startConnectionAuth("slack")}
                title="Connect Slack OAuth"
              >
                Connect ↗
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="conn-badge badge-ok"
              disabled
              title="Slack connected"
            >
              Connected
            </button>
          )}
        </div>

        <div className="conn-row">
          <div className="conn-icon-wrap discord-bg"><IconDiscord /></div>
          <div className="conn-info">
            <div className="conn-name">Discord</div>
            <div className="conn-ws">workspace: servers</div>
          </div>
          {!discordConn?.connected ? (
            <div className="conn-actions">
              <button
                type="button"
                className="conn-badge badge-warn"
                onClick={() => window.open(DISCORD_INSTALL_URL, "_blank", "noopener,noreferrer")}
                title="Install Delegate bot to Discord"
              >
                Install ↗
              </button>
              <button
                type="button"
                className="conn-badge badge-warn"
                onClick={() => startConnectionAuth("discord")}
                title="Connect Discord OAuth"
              >
                Connect ↗
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="conn-badge badge-ok"
              disabled
              title="Discord connected"
            >
              Connected
            </button>
          )}
        </div>

        <div className="install-card">
          <div className="install-title">Install Delegate</div>
          <details className="install-menu" open>
            <summary><IconSlack /> Slack setup</summary>
            <ol>
              <li>Create or open your Slack app from Slack API.</li>
              <li>Install it to your workspace.</li>
              <li>Come back and click Connect for Slack.</li>
            </ol>
            <button
              type="button"
              className="install-btn"
              onClick={() => window.open(SLACK_INSTALL_URL, "_blank", "noopener,noreferrer")}
            >
              Open Slack App Setup ↗
            </button>
          </details>

          <details className="install-menu" open>
            <summary><IconDiscord /> Discord setup</summary>
            <ol>
              <li>Install Delegate bot to your server.</li>
              <li>Grant read history + send message permissions.</li>
              <li>Come back and click Connect for Discord.</li>
            </ol>
            <button
              type="button"
              className="install-btn"
              onClick={() => window.open(DISCORD_INSTALL_URL, "_blank", "noopener,noreferrer")}
            >
              Install Delegate to Discord ↗
            </button>
          </details>
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

const ALL_HINTS = [
  "Summarize #eng-alerts from last 24h",
  "Draft my standup from Slack activity",
  "List my Discord servers and channels",
  "What's urgent in #product this week?",
  "Post a status update to #general",
  "Check latest messages in #announcements",
  "Get a summary of team discussions",
  "Show recent activity across channels",
];

function getRandomHints(count: number = 3): string[] {
  const shuffled = [...ALL_HINTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function App() {
  const { isLoading, isAuthenticated, user } = useAuth0();
  const { messages, isStreaming, connections, context, setContext, sendMessage, fetchConnections, stop, clearMessages } = useAgent();
  const [input, setInput] = useState("");
  const [dismissedAuth, setDismissedAuth] = useState<Set<string>>(new Set());
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hints, setHints] = useState<string[]>(getRandomHints());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 769px)");

    const handleViewportChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) {
        setSidebarOpen(true);
      }
    };

    handleViewportChange(media);

    media.addEventListener("change", handleViewportChange);
    return () => media.removeEventListener("change", handleViewportChange);
  }, []);

  // Refresh hints when active context changes
  useEffect(() => {
    setHints(getRandomHints());
  }, [context?.service]);

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchConnections();

    const pending = sessionStorage.getItem("delegate:pending-connection");
    if (!pending) return;

    let attempts = 0;
    const maxAttempts = 8;
    const interval = window.setInterval(async () => {
      attempts += 1;
      await fetchConnections();

      if (attempts >= maxAttempts) {
        sessionStorage.removeItem("delegate:pending-connection");
        window.clearInterval(interval);
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, fetchConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const description = params.get("error_description");

    if (!error) return;

    const message = description
      ? `${error}: ${description}`
      : error;

    setAuthCallbackError(message);

    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }, []);

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

      <div className={`body-row ${sidebarOpen ? "with-sidebar" : "no-sidebar"}`}>
        {sidebarOpen && <Sidebar connections={connections} context={context} setContext={setContext} onClear={clearMessages} onClose={() => setSidebarOpen(false)} />}
        {sidebarOpen && <button className="mobile-overlay" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

        <main className="main">
          {!sidebarOpen && <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">⋯</button>}
          {authCallbackError && (
            <div className="auth-prompt" style={{ margin: "14px 28px 0" }}>
              <div className="ap-title"><IconAuth /> Auth connection failed</div>
              <p className="ap-body">
                {authCallbackError}
                {" "}
                Make sure this connection is enabled for your Auth0 SPA application.
              </p>
              <div className="ap-btns">
                <button className="btn-cancel" onClick={() => setAuthCallbackError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="chat-scroll">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="es-mark">✦</div>
                <div className="es-title">What should I handle?</div>
                <div className="es-sub">Ask me to read or post to Slack and Discord channels.</div>
                <div className="es-hints">
                  {hints.map(h => (
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
                connections={connections}
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
              Delegate can read/post Slack and Discord · powered by OpenRouter + Auth0
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
