import { useState, useEffect, useRef, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { API_BASE_URL } from "../utils/api"

const API = API_BASE_URL

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileBasename(path) {
  return path.split("/").pop()
}

function distanceToPercent(d) {
  // Cosine distance: 0 = identical, 2 = opposite. Map to relevance %.
  if (d == null) return null
  return Math.max(0, Math.round((1 - d / 2) * 100))
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourcesPanel({ sources, isOpen, onToggle }) {
  if (!sources || sources.length === 0) return null
  return (
    <div className="chat-sources">
      <button className="chat-sources-toggle" onClick={onToggle}>
        <span className="chat-sources-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
            <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
            <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.8" />
          </svg>
        </span>
        {sources.length} source{sources.length !== 1 ? "s" : ""} retrieved
        <span className="chat-sources-chevron" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      {isOpen && (
        <div className="chat-sources-list">
          {sources.map((s) => {
            const relevance = distanceToPercent(s.distance)
            return (
              <div key={s.id} className="chat-source-item">
                <div className="chat-source-header">
                  <span className="chat-source-file">{fileBasename(s.filename)}</span>
                  <span className="chat-source-chunk">chunk {s.chunk_index}</span>
                  {relevance !== null && (
                    <span className="chat-source-relevance">{relevance}% match</span>
                  )}
                </div>
                <p className="chat-source-excerpt">{s.document.slice(0, 220)}{s.document.length > 220 ? "…" : ""}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChatMessage({ msg, isStreaming }) {
  const [copied, setCopied] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      <div className="chat-message-meta">
        <span className="chat-message-role">{msg.role === "user" ? "You" : "Assistant"}</span>
        {!isStreaming && msg.role === "assistant" && (
          <button className="chat-copy-btn" onClick={handleCopy} title="Copy">
            {copied ? "✓" : "⎘"}
          </button>
        )}
      </div>
      <div className="chat-message-body">
        {msg.role === "assistant" ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                return <pre className="chat-code-block">{children}</pre>
              },
              code({ node, className, children, ...props }) {
                return className ? (
                  <code className={className} {...props}>{children}</code>
                ) : (
                  <code className="chat-inline-code" {...props}>{children}</code>
                )
              },
            }}
          >
            {msg.content + (isStreaming ? "▌" : "")}
          </ReactMarkdown>
        ) : (
          <p className="chat-user-text">{msg.content}</p>
        )}
      </div>
      {msg.sources && (
        <SourcesPanel
          sources={msg.sources}
          isOpen={sourcesOpen}
          onToggle={() => setSourcesOpen((o) => !o)}
        />
      )}
    </div>
  )
}

function SettingsPanel({ config, onChange, files, onClose }) {
  const handleChange = (key, value) => onChange({ ...config, [key]: value })
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaError, setOllamaError] = useState(null)

  // Fetch Ollama models whenever the provider or base URL changes
  useEffect(() => {
    if (config.provider !== "ollama") return
    setOllamaError(null)
    const url = `${API}/chat/ollama-models?base_url=${encodeURIComponent(config.ollama_base_url)}`
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.models) setOllamaModels(data.models)
        else setOllamaError(data.detail || "Unknown error")
      })
      .catch(() => setOllamaError("Could not reach backend"))
  }, [config.provider, config.ollama_base_url])

  return (
    <div className="chat-settings-panel">
      <div className="chat-settings-header">
        <span>Settings</span>
        <button className="chat-settings-close" onClick={onClose}>✕</button>
      </div>

      <label className="chat-settings-label">Provider</label>
      <select
        className="chat-settings-select"
        value={config.provider}
        onChange={(e) => {
          const p = e.target.value
          onChange({
            ...config,
            provider: p,
            model: p === "ollama" ? "" : "gpt-4o-mini",
          })
        }}
      >
        <option value="openai">OpenAI</option>
        <option value="ollama">Ollama (local)</option>
      </select>

      {config.provider === "ollama" && (
        <>
          <label className="chat-settings-label">Ollama base URL</label>
          <input
            type="text"
            className="chat-settings-input"
            value={config.ollama_base_url}
            onChange={(e) => handleChange("ollama_base_url", e.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </>
      )}

      <label className="chat-settings-label">Model</label>
      {config.provider === "ollama" ? (
        ollamaModels.length > 0 ? (
          <select
            className="chat-settings-select"
            value={config.model}
            onChange={(e) => handleChange("model", e.target.value)}
          >
            <option value="">— select a model —</option>
            {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <>
            <input
              type="text"
              className="chat-settings-input"
              value={config.model}
              onChange={(e) => handleChange("model", e.target.value)}
              placeholder="e.g. llama3, mistral"
            />
            {ollamaError && <span style={{ fontSize: "11px", color: "var(--color-danger, #e55)" }}>{ollamaError}</span>}
          </>
        )
      ) : (
        <select
          className="chat-settings-select"
          value={config.model}
          onChange={(e) => handleChange("model", e.target.value)}
        >
          <option value="gpt-4o-mini">gpt-4o-mini</option>
          <option value="gpt-4o">gpt-4o</option>
          <option value="gpt-4-turbo">gpt-4-turbo</option>
          <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
        </select>
      )}

      <label className="chat-settings-label">Temperature — {config.temperature}</label>
      <input
        type="range" min="0" max="1" step="0.05"
        className="chat-settings-range"
        value={config.temperature}
        onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
      />

      <label className="chat-settings-label">Max tokens</label>
      <input
        type="number" min="64" max="4096" step="64"
        className="chat-settings-input"
        value={config.max_tokens}
        onChange={(e) => handleChange("max_tokens", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label">RAG — top-K chunks</label>
      <input
        type="number" min="1" max="20" step="1"
        className="chat-settings-input"
        value={config.top_k}
        onChange={(e) => handleChange("top_k", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label">
        <input
          type="checkbox"
          checked={config.rag_enabled}
          onChange={(e) => handleChange("rag_enabled", e.target.checked)}
          style={{ marginRight: "8px" }}
        />
        Enable RAG retrieval
      </label>

      <label className="chat-settings-label" style={{ marginTop: "12px" }}>Filter by file (optional)</label>
      <select
        className="chat-settings-select"
        value={config.filename_filter || ""}
        onChange={(e) => handleChange("filename_filter", e.target.value || null)}
      >
        <option value="">All files</option>
        {files.map((f) => (
          <option key={f} value={f}>{fileBasename(f)}</option>
        ))}
      </select>

      <label className="chat-settings-label" style={{ marginTop: "12px" }}>System prompt</label>
      <textarea
        className="chat-settings-textarea"
        rows={5}
        value={config.system_prompt}
        onChange={(e) => handleChange("system_prompt", e.target.value)}
      />
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  provider: "openai",
  ollama_base_url: "http://localhost:11434/v1",
  model: "gpt-4o-mini",
  temperature: 0.3,
  max_tokens: 1024,
  top_k: 5,
  rag_enabled: true,
  filename_filter: null,
  system_prompt:
    "You are a helpful, knowledgeable assistant. " +
    "When relevant context is provided from the knowledge base, use it to answer accurately. " +
    "Always cite the source document name when drawing from retrieved context. " +
    "If the context does not contain an answer, say so clearly and answer from general knowledge if possible. " +
    "Format your responses in clear, readable Markdown.",
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]) // { role, content, sources? }
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState("idle") // "idle" | "searching" | "streaming" | "error"
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)

  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const textareaRef = useRef(null)

  // Fetch file list on mount
  useEffect(() => {
    fetch(`${API}/files`)
      .then((r) => r.json())
      .then((data) => setFiles(data.map((f) => f.filename)))
      .catch(() => {})
  }, [])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput("")
    setError(null)

    const userMsg = { role: "user", content: text }
    const history = messages.map(({ role, content }) => ({ role, content }))

    setMessages((prev) => [...prev, userMsg])
    setStreaming(true)
    setStatus("searching")

    // Placeholder for the assistant message that we'll fill as tokens arrive
    setMessages((prev) => [...prev, { role: "assistant", content: "", sources: null }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, ...config }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const parts = buffer.split("\n\n")
        buffer = parts.pop() // keep incomplete tail

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith("data:")) continue
          let payload
          try {
            payload = JSON.parse(line.slice("data:".length).trim())
          } catch {
            continue
          }

          if (payload.type === "sources") {
            setStatus("streaming")
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], sources: payload.sources }
              return next
            })
          } else if (payload.type === "token") {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, content: last.content + payload.content }
              return next
            })
          } else if (payload.type === "done") {
            // stream complete
          } else if (payload.type === "error") {
            throw new Error(payload.message)
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message)
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === "assistant" && last.content === "") {
            return next.slice(0, -1) // remove empty assistant placeholder
          }
          return next
        })
      }
    } finally {
      setStreaming(false)
      setStatus("idle")
      abortRef.current = null
    }
  }, [input, messages, streaming, config])

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleClearHistory = () => {
    if (streaming) return
    setMessages([])
    setError(null)
  }

  const statusLabel = {
    idle: null,
    searching: "Searching knowledge base…",
    streaming: "Writing…",
    error: "Error",
  }[status]

  return (
    <div className="page chat-page">
      {/* ── Top bar ── */}
      <div className="topbar">
        <span className="topbar-title">Chat</span>
        {config.rag_enabled ? (
          <span className="status-chip success" style={{ fontSize: "10px" }}>RAG on</span>
        ) : (
          <span className="status-chip idle" style={{ fontSize: "10px" }}>RAG off</span>
        )}
        <span className="chat-model-badge">{config.provider === "ollama" ? "🦙 " : ""}{config.model || "—"}</span>
        <div className="topbar-actions">
          {messages.length > 0 && (
            <button className="btn btn-danger" onClick={handleClearHistory} disabled={streaming}>
              Clear history
            </button>
          )}
          <button
            className={`btn ${settingsOpen ? "btn-primary" : ""}`}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      <div className="chat-body">
        {/* ── Settings sidebar ── */}
        {settingsOpen && (
          <SettingsPanel
            config={config}
            onChange={setConfig}
            files={files}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {/* ── Main column: messages + input ── */}
        <div className="chat-main">

        {/* ── Message list ── */}
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <svg width="32" height="32" viewBox="0 0 16 16" fill="none">
                  <path d="M2 3h12v8H9l-3 2v-2H2V3z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
                </svg>
              </div>
              <p>Ask anything about your uploaded documents.</p>
              <p className="chat-empty-hint">RAG retrieval is {config.rag_enabled ? "enabled" : "disabled"} · Model: {config.model}</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              msg={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          {error && (
            <div className="chat-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {statusLabel && (
            <div className="chat-status-bar">
              <span className="chat-status-dot" />
              {statusLabel}
            </div>
          )}
          <div className="chat-input-row">
            <textarea
              ref={textareaRef}
              className="chat-input"
              rows={1}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
            />
            {streaming ? (
              <button className="chat-send-btn btn-danger" onClick={handleStop} title="Stop">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className="chat-send-btn"
                onClick={sendMessage}
                disabled={!input.trim()}
                title="Send"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="8" x2="14" y2="8" />
                  <polyline points="9,3 14,8 9,13" />
                </svg>
              </button>
            )}
          </div>
        </div>

        </div>
      </div>
    </div>
  )
}
