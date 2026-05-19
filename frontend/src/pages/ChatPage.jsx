import { useState, useEffect, useRef, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { API_BASE_URL } from "../utils/api"
import { useNotebooks } from "../context/NotebookProvider"

const API = API_BASE_URL
const CHAT_HISTORY_KEY_PREFIX = "raginator.chatHistory"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileBasename(path) {
  return path.split("/").pop()
}

function distanceToPercent(d) {
  // Cosine distance: 0 = identical, 2 = opposite. Map to relevance %.
  if (d == null) return null
  return Math.max(0, Math.round((1 - d / 2) * 100))
}

function getChatHistoryStorageKey(notebookId) {
  return `${CHAT_HISTORY_KEY_PREFIX}.${notebookId || "global"}`
}

function parseStoredMessages(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string"
    )
  } catch {
    return []
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourcesPanel({ sources, retrieval, isOpen, onToggle }) {
  if ((!sources || sources.length === 0) && !retrieval) return null
  const stage = retrieval?.stages || null
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
        {sources?.length || 0} source{(sources?.length || 0) !== 1 ? "s" : ""} retrieved
        <span className="chat-sources-chevron" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      {isOpen && (
        <div className="chat-sources-list">
          {retrieval && (
            <div className="chat-source-item" style={{ background: "rgba(25, 85, 160, 0.08)", borderStyle: "dashed" }}>
              <div className="chat-source-header">
                <span className="chat-source-file">retrieval pipeline</span>
                <span className="chat-source-chunk">{retrieval.retrieval_mode || "hybrid"}</span>
                <span className="chat-source-relevance">rerank {retrieval.rerank_enabled ? "on" : "off"}</span>
              </div>
              <p className="chat-source-excerpt">
                top_k {retrieval.top_k} · min score {retrieval.min_relevance_score} · returned {retrieval.returned_count}
              </p>
              {stage && (
                <p className="chat-source-excerpt" style={{ marginTop: "6px" }}>
                  dense {stage.dense?.returned ?? 0}/{stage.dense?.requested_k ?? 0} · lexical {stage.lexical?.returned ?? 0}/{stage.lexical?.requested_k ?? 0} · fusion {stage.fusion?.output ?? 0} · rerank {stage.rerank?.backend || retrieval.rerank_backend || "none"} ({stage.rerank?.output ?? 0}) · threshold drop {stage.threshold?.dropped ?? retrieval.dropped_below_score ?? 0}
                </p>
              )}
            </div>
          )}
          {(sources || []).map((s) => {
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
                <p className="chat-source-excerpt">
                  {s.document.slice(0, 220)}{s.document.length > 220 ? "…" : ""}
                </p>
                <p className="chat-source-excerpt" style={{ marginTop: "4px" }}>
                  scores · dense {s.dense_score ?? "-"} · lexical {s.lexical_score ?? "-"} · fusion {s.fusion_score ?? "-"} · rerank {s.rerank_score ?? "-"}
                </p>
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
              code({ className, children, ...props }) {
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
          retrieval={msg.retrieval}
          isOpen={sourcesOpen}
          onToggle={() => setSourcesOpen((o) => !o)}
        />
      )}
    </div>
  )
}

function SettingsPanel({ config, onChange, files, activeNotebook, onClose }) {
  const handleChange = (key, value) => onChange({ ...config, [key]: value })
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaError, setOllamaError] = useState(null)
  const settingDescriptions = {
    provider: "Choose which LLM backend powers chat responses.",
    ollamaBaseUrl: "Base API endpoint for your local Ollama server.",
    model: "Model name used for generation.",
    temperature: "Controls randomness. Lower is more deterministic; higher is more creative.",
    maxTokens: "Maximum tokens the model can generate for each response.",
    topK: "Number of top retrieved chunks sent to the model as context.",
    retrievalMode: "Hybrid mixes dense and lexical search; dense uses embeddings only.",
    reranker: "Adds a reranking stage to improve final chunk ordering before generation.",
    minRelevance: "Filters out chunks below this relevance threshold.",
    densePool: "How many dense-search candidates to collect before filtering/reranking.",
    lexicalPool: "How many keyword-search candidates to collect before filtering/reranking.",
    rerankPool: "How many candidates are passed into the reranker stage.",
    ragEnabled: "When off, the model answers without retrieval from your indexed files.",
    retrievalDebug: "Includes retrieval diagnostics and scoring metadata in the response payload.",
    fileFilter: "Limit retrieval to a single file. Leave as All files for global search.",
    systemPrompt: "High-level behavior instructions prepended to every request.",
  }

  // Fetch Ollama models whenever the provider or base URL changes
  useEffect(() => {
    if (config.provider !== "ollama") return
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

      <label className="chat-settings-label" title={settingDescriptions.provider}>Provider</label>
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
          <label className="chat-settings-label" title={settingDescriptions.ollamaBaseUrl}>Ollama base URL</label>
          <input
            type="text"
            className="chat-settings-input"
            value={config.ollama_base_url}
            onChange={(e) => handleChange("ollama_base_url", e.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </>
      )}

      <label className="chat-settings-label" title={settingDescriptions.model}>Model</label>
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

      <label className="chat-settings-label" title={settingDescriptions.temperature}>Temperature — {config.temperature}</label>
      <input
        type="range" min="0" max="1" step="0.05"
        className="chat-settings-range"
        value={config.temperature}
        onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
      />

      <label className="chat-settings-label" title={settingDescriptions.maxTokens}>Max tokens</label>
      <input
        type="number" min="64" max="4096" step="64"
        className="chat-settings-input"
        value={config.max_tokens}
        onChange={(e) => handleChange("max_tokens", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label" title={settingDescriptions.topK}>RAG — top-K chunks</label>
      <input
        type="number" min="1" max="20" step="1"
        className="chat-settings-input"
        value={config.top_k}
        onChange={(e) => handleChange("top_k", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label" title={settingDescriptions.retrievalMode}>RAG — retrieval mode</label>
      <select
        className="chat-settings-select"
        value={config.retrieval_mode}
        onChange={(e) => handleChange("retrieval_mode", e.target.value)}
      >
        <option value="hybrid">Hybrid (dense + BM25)</option>
        <option value="dense">Dense only</option>
      </select>

      <label className="chat-settings-label" title={settingDescriptions.reranker}>
        <input
          type="checkbox"
          checked={config.rerank_enabled}
          onChange={(e) => handleChange("rerank_enabled", e.target.checked)}
          style={{ marginRight: "8px" }}
        />
        Enable reranker stage
      </label>

      <label className="chat-settings-label" title={settingDescriptions.minRelevance}>RAG — minimum relevance score ({config.min_relevance_score})</label>
      <input
        type="range" min="0" max="1" step="0.01"
        className="chat-settings-range"
        value={config.min_relevance_score}
        onChange={(e) => handleChange("min_relevance_score", parseFloat(e.target.value))}
      />

      <label className="chat-settings-label" title={settingDescriptions.densePool}>Dense candidate pool</label>
      <input
        type="number" min="1" max="200" step="1"
        className="chat-settings-input"
        value={config.dense_candidate_k}
        onChange={(e) => handleChange("dense_candidate_k", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label" title={settingDescriptions.lexicalPool}>Lexical candidate pool</label>
      <input
        type="number" min="1" max="200" step="1"
        className="chat-settings-input"
        value={config.lexical_candidate_k}
        onChange={(e) => handleChange("lexical_candidate_k", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label" title={settingDescriptions.rerankPool}>Rerank candidate pool</label>
      <input
        type="number" min="1" max="200" step="1"
        className="chat-settings-input"
        value={config.rerank_candidate_k}
        onChange={(e) => handleChange("rerank_candidate_k", parseInt(e.target.value, 10))}
      />

      <label className="chat-settings-label" title={settingDescriptions.ragEnabled}>
        <input
          type="checkbox"
          checked={config.rag_enabled}
          onChange={(e) => handleChange("rag_enabled", e.target.checked)}
          style={{ marginRight: "8px" }}
        />
        Enable RAG retrieval
      </label>

      <label className="chat-settings-label" title={settingDescriptions.retrievalDebug}>
        <input
          type="checkbox"
          checked={config.retrieval_debug}
          onChange={(e) => handleChange("retrieval_debug", e.target.checked)}
          style={{ marginRight: "8px" }}
        />
        Include retrieval diagnostics
      </label>

      <label className="chat-settings-label" title={settingDescriptions.fileFilter} style={{ marginTop: "12px" }}>Filter by file (optional)</label>
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
      {activeNotebook && (
        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
          Scoped to notebook: {activeNotebook.name}
        </span>
      )}

      <label className="chat-settings-label" title={settingDescriptions.systemPrompt} style={{ marginTop: "12px" }}>System prompt</label>
      <textarea
        className="chat-settings-textarea"
        rows={12}
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
  retrieval_mode: "hybrid",
  rerank_enabled: true,
  min_relevance_score: 0.2,
  dense_candidate_k: 20,
  lexical_candidate_k: 20,
  rerank_candidate_k: 16,
  rag_enabled: true,
  retrieval_debug: false,
  filename_filter: null,
  system_prompt:
    "You are a helpful, knowledgeable assistant. " +
    "When relevant notebook content is provided from the knowledge base, use it to answer accurately. " +
    "Always cite the source document name when drawing from retrieved notebook content. " +
    "If the notebook content does not contain an answer, say so clearly and answer from general knowledge if possible. " +
    "Format your responses in clear, readable Markdown.",
}

export default function ChatPage() {
  const { activeNotebook, activeNotebookId } = useNotebooks()
  const [messages, setMessages] = useState([]) // { role, content, sources?, retrieval? }
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState("idle") // "idle" | "searching" | "streaming" | "error"
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const [historyReady, setHistoryReady] = useState(false)

  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const textareaRef = useRef(null)

  // Load chat history for the active notebook.
  useEffect(() => {
    const key = getChatHistoryStorageKey(activeNotebookId)
    const saved = parseStoredMessages(localStorage.getItem(key))
    setMessages(saved)
    setError(null)
    setHistoryReady(true)
  }, [activeNotebookId])

  // Persist chat history so tab navigation does not clear it.
  useEffect(() => {
    if (!historyReady) return
    const key = getChatHistoryStorageKey(activeNotebookId)
    if (messages.length === 0) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify(messages))
  }, [messages, activeNotebookId, historyReady])

  // Fetch file list on mount
  useEffect(() => {
    fetch(`${API}/files`)
      .then((r) => r.json())
      .then((data) => {
        const names = data.map((f) => f.filename)
        if (!activeNotebook) {
          setFiles(names)
          return
        }
        const allowed = new Set(activeNotebook.filenames || [])
        setFiles(names.filter((name) => allowed.has(name)))
      })
      .catch(() => {})
  }, [activeNotebook])

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
    const STREAM_INACTIVITY_MS = 90000
    let inactivityTimer = null
    let didTimeout = false

    const clearInactivityTimer = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer)
        inactivityTimer = null
      }
    }

    const resetInactivityTimer = () => {
      clearInactivityTimer()
      inactivityTimer = setTimeout(() => {
        didTimeout = true
        controller.abort()
      }, STREAM_INACTIVITY_MS)
    }

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          ...config,
          notebook_id: activeNotebook?.id || null,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let streamFinished = false
      resetInactivityTimer()

      while (!streamFinished) {
        const { done, value } = await reader.read()
        if (done) break
        resetInactivityTimer()
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
              next[next.length - 1] = {
                ...next[next.length - 1],
                sources: payload.sources,
                retrieval: payload.retrieval || null,
              }
              return next
            })
          } else if (payload.type === "token") {
            setStatus("streaming")
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, content: last.content + payload.content }
              return next
            })
          } else if (payload.type === "done") {
            streamFinished = true
          } else if (payload.type === "error") {
            throw new Error(payload.message)
          }
        }
      }

      // Process any trailing buffered payload if stream closed without a final split.
      const tail = buffer.trim()
      if (!streamFinished && tail.startsWith("data:")) {
        try {
          const payload = JSON.parse(tail.slice("data:".length).trim())
          if (payload.type === "done") {
            streamFinished = true
          } else if (payload.type === "error") {
            throw new Error(payload.message)
          }
        } catch {
          // Ignore malformed tail fragments.
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
      } else if (didTimeout) {
        setError("The model stream timed out due to inactivity. Try again or switch model/provider.")
      }
    } finally {
      clearInactivityTimer()
      setStreaming(false)
      setStatus("idle")
      abortRef.current = null
    }
  }, [input, messages, streaming, config, activeNotebook?.id])

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
        {activeNotebook && <span className="status-chip embedding">Notebook: {activeNotebook.name}</span>}
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

        {/* ── Settings sidebar ── */}
        {settingsOpen && (
          <SettingsPanel
            config={config}
            onChange={setConfig}
            files={files}
            activeNotebook={activeNotebook}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
