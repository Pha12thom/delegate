import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallEvent[];
  authRequired?: AuthRequiredEvent;
  timestamp: Date;
}

export interface ToolCallEvent {
  tool: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "pending" | "done" | "error";
}

export interface AuthRequiredEvent {
  connection: string;
  tool: string;
}

export interface MessageContext {
  service?: "slack" | "discord";
  workspaceId?: string;
  channelId?: string;
}

// Load messages from localStorage
function loadMessagesFromStorage(): Record<string, ChatMessage[]> {
  try {
    const stored = localStorage.getItem("delegate:messages");
    if (!stored) return { slack: [], discord: [] };
    
    const data = JSON.parse(stored);
    // Check if chat expired (3 hours = 10,800,000 ms)
    const now = Date.now();
    const chatExpiry = 3 * 60 * 60 * 1000;
    
    const slack = (data.slack || [])
      .map((m: any) => ({
        ...m,
        timestamp: typeof m.timestamp === 'string' ? new Date(m.timestamp) : m.timestamp,
      }))
      .filter((m: ChatMessage) => 
        m.timestamp.getTime() > now - chatExpiry
      );
    
    const discord = (data.discord || [])
      .map((m: any) => ({
        ...m,
        timestamp: typeof m.timestamp === 'string' ? new Date(m.timestamp) : m.timestamp,
      }))
      .filter((m: ChatMessage) => 
        m.timestamp.getTime() > now - chatExpiry
      );
    
    return { slack, discord };
  } catch {
    return { slack: [], discord: [] };
  }
}

export function useAgent() {
  const { getAccessTokenSilently } = useAuth0();
  const [messagesByService, setMessagesByService] = useState<Record<string, ChatMessage[]>>(
    loadMessagesFromStorage()
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [connections, setConnections] = useState<
    { connection: string; connected: boolean }[]
  >([]);
  const [context, setContext] = useState<MessageContext>({
    service: "slack",
  });
  const abortRef = useRef<AbortController | null>(null);

  // Get current service's messages
  const messages = messagesByService[context.service || "slack"] || [];

  // Auto-save to localStorage whenever messages change
  useEffect(() => {
    localStorage.setItem("delegate:messages", JSON.stringify(messagesByService));
  }, [messagesByService]);

  const fetchConnections = useCallback(async () => {
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch("/api/connections", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let details = `HTTP ${res.status}`;
        try {
          const errorData = await res.json();
          if (errorData?.error) {
            details = `${details}: ${errorData.error}`;
          }
        } catch {
          // ignore non-JSON body
        }
        throw new Error(`Failed to fetch connections (${details})`);
      }

      const data = await res.json();
      setConnections(data.connections || []);
    } catch (err) {
      console.error("Failed to fetch connections:", err);
    }
  }, [getAccessTokenSilently]);

  const sendMessage = useCallback(
    async (userText: string) => {
      if (isStreaming) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userText,
        timestamp: new Date(),
      };

      const agentMsgId = crypto.randomUUID();
      const agentMsg: ChatMessage = {
        id: agentMsgId,
        role: "assistant",
        content: "",
        toolCalls: [],
        timestamp: new Date(),
      };

      setMessagesByService((prev) => ({
        ...prev,
        [context.service || "slack"]: [...(prev[context.service || "slack"] || []), userMsg, agentMsg],
      }));
      setIsStreaming(true);

      // Build message history for API (exclude the empty agent msg we just added)
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const token = await getAccessTokenSilently();
        const abort = new AbortController();
        abortRef.current = abort;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messages: history, context }),
          signal: abort.signal,
        });

        if (!res.ok) {
          let errorMessage = `Chat request failed (${res.status})`;
          try {
            const data = await res.json();
            if (data?.error) {
              errorMessage = `Chat request failed (${res.status}): ${data.error}`;
            }
          } catch {
            // ignore non-JSON error bodies
          }
          throw new Error(errorMessage);
        }

        if (!res.body) {
          throw new Error("Chat stream did not start (empty response body)");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            try {
              const event = JSON.parse(json);
              handleEvent(event, agentMsgId);
            } catch {
              // malformed SSE line, skip
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessagesByService((prev) => {
            const serviceKey = context.service || "slack";
            return {
              ...prev,
              [serviceKey]: (prev[serviceKey] || []).map((m) =>
                m.id === agentMsgId
                  ? { ...m, content: err.message || "Something went wrong. Please try again." }
                  : m
              ),
            };
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, getAccessTokenSilently, context]
  );

  function handleEvent(event: Record<string, unknown>, agentMsgId: string) {
    setMessagesByService((prev) => {
      const serviceKey = context.service || "slack";
      return {
        ...prev,
        [serviceKey]: (prev[serviceKey] || []).map((m) => {
          if (m.id !== agentMsgId) return m;

          switch (event.type) {
            case "text":
              return { ...m, content: m.content + (event.text as string) };

            case "tool_call":
              return {
                ...m,
                toolCalls: [
                  ...(m.toolCalls || []),
                  {
                    tool: event.tool as string,
                    input: event.input as Record<string, unknown>,
                    status: "pending" as const,
                  },
                ],
              };

            case "tool_result":
              return {
                ...m,
                toolCalls: (m.toolCalls || []).map((tc) =>
                  tc.tool === (event.tool as string) && tc.status === "pending"
                    ? { ...tc, result: event.result, status: "done" as const }
                    : tc
                ),
              };

            case "tool_error":
              return {
                ...m,
                toolCalls: (m.toolCalls || []).map((tc) =>
                  tc.tool === (event.tool as string) && tc.status === "pending"
                    ? {
                        ...tc,
                        error: event.error as string,
                        status: "error" as const,
                      }
                    : tc
                ),
              };

            case "auth_required":
              return {
                ...m,
                authRequired: {
                  connection: event.connection as string,
                  tool: event.tool as string,
                },
              };

            default:
              return m;
          }
        }),
      };
    });
  }

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessagesByService((prev) => ({
      ...prev,
      [context.service || "slack"]: [],
    }));
  }, [context.service]);

  return {
    messages,
    isStreaming,
    connections,
    context,
    setContext,
    sendMessage,
    fetchConnections,
    stop,
    clearMessages,
  };
}
