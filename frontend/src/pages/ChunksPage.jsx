import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "../utils/api"
import { useNotebooks } from "../context/NotebookProvider"

const API = API_BASE_URL

export default function ChunksPage() {
  const { activeNotebook } = useNotebooks()
  const [chunks, setChunks] = useState([])
  const [total, setTotal] = useState(0)
  const [filenameFilter, setFilenameFilter] = useState("")
  const [methodFilter, setMethodFilter] = useState("")
  const [chunkedFiles, setChunkedFiles] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())

  useEffect(() => {
    if (!activeNotebook) {
      setChunkedFiles([])
      return
    }
    axios.get(`${API}/files`).then((res) => {
      const files = Array.isArray(res.data) ? res.data : (res.data?.files || [])
      const allowed = new Set(activeNotebook?.filenames || [])
      const nextChunked = files
        .filter((f) => f.chunk_count > 0)
        .map((f) => f.filename)
        .filter((filename) => !activeNotebook || allowed.has(filename))
      setChunkedFiles(nextChunked)
    }).catch(() => {})
  }, [activeNotebook])

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fetchChunks = useCallback(async () => {
    if (!activeNotebook?.id) {
      setChunks([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("limit", "300")
      if (filenameFilter.trim()) params.set("filename", filenameFilter.trim())
      params.set("notebook_id", activeNotebook.id)
      if (methodFilter.trim()) params.set("chunk_method", methodFilter.trim())

      const res = await axios.get(`${API}/chunks?${params.toString()}`)
      setChunks(res.data.items || [])
      setTotal(res.data.count || 0)
    } catch (err) {
      console.error("Failed to load chunks:", err)
    } finally {
      setLoading(false)
    }
  }, [filenameFilter, methodFilter, activeNotebook])

  useEffect(() => {
    fetchChunks()
  }, [fetchChunks])

  const handleSearch = async () => {
    if (!activeNotebook) {
      setSearchResults([])
      return
    }
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    try {
      const payload = {
        query: searchQuery.trim(),
        top_k: 8,
      }
      if (filenameFilter.trim()) payload.filename = filenameFilter.trim()
      payload.filenames = activeNotebook.filenames || []

      const res = await axios.post(`${API}/search`, payload)
      setSearchResults(res.data.matches || [])
    } catch (err) {
      console.error("Search failed:", err)
      setSearchResults([])
    }
  }

  const methodSummary = chunks.reduce((acc, chunk) => {
    const key = chunk.chunk_method || "unknown"
    if (!acc[key]) {
      acc[key] = { count: 0, totalLength: 0 }
    }
    acc[key].count += 1
    acc[key].totalLength += Number.isFinite(chunk.chunk_length) ? chunk.chunk_length : (chunk.document || "").length
    return acc
  }, {})
  const methodOptions = Object.keys(methodSummary).sort((a, b) => a.localeCompare(b))

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <div className="topbar">
        <div className="topbar-title">Chunks Explorer</div>
        {activeNotebook ? (
          <span className="status-chip embedding">Notebook: {activeNotebook.name}</span>
        ) : (
          <span className="status-chip error">No notebook selected</span>
        )}
        <div className="topbar-actions" style={{ marginLeft: "auto", width: "100%", justifyContent: "flex-end" }}>
          <select
            className="select"
            value={filenameFilter}
            onChange={(e) => setFilenameFilter(e.target.value)}
          >
            <option value="">All files</option>
            {chunkedFiles.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select
            className="select"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            title="Filter chunks by chunking method"
          >
            <option value="">All methods</option>
            {methodOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className="btn" type="button" onClick={fetchChunks}>
            Refresh
          </button>
          <input
            className="input"
            placeholder="Search in embedded chunks"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "260px" }}
          />
          <button className="btn btn-primary" type="button" onClick={handleSearch}>
            Search
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {!activeNotebook && (
          <div style={{ color: "var(--muted)", fontSize: "12px" }}>
            Select a notebook on the Notebook Select page to view chunks.
          </div>
        )}
        {searchResults.length > 0 && (
          <>
            <div className="section-label">Search Results ({searchResults.length})</div>
            <div className="cards-grid">
              {searchResults.map((result) => {
                const isExp = expandedIds.has(result.id)
                return (
                  <article
                    key={result.id}
                    className={`chunk-card search-result${isExp ? " expanded" : ""}`}
                    onClick={() => toggleExpand(result.id)}
                  >
                    <div className="chunk-card-top">
                      <span className="status-chip idle">{result.filename || "unknown"}</span>
                      <span className="status-chip embedding">Distance: {String(result.distance ?? "-")}</span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      {result.chunk_method && (
                        <span className="status-chip idle" style={{ textTransform: "capitalize" }}>{result.chunk_method}</span>
                      )}
                      {Number.isFinite(result.chunk_length) && (
                        <span className="status-chip success">{result.chunk_length} chars</span>
                      )}
                    </div>
                    <p className={`chunk-text${isExp ? " expanded" : ""}`}>{result.document || "(empty result)"}</p>
                    <span className="chunk-card-expand-hint">{isExp ? "click to collapse" : "click to expand"}</span>
                  </article>
                )
              })}
            </div>
          </>
        )}

        {methodOptions.length > 0 && (
          <>
            <div className="section-label">Chunk Strategy Snapshot</div>
            <div className="cards-grid">
              {methodOptions.map((method) => {
                const summary = methodSummary[method]
                const avgLength = summary.count ? Math.round(summary.totalLength / summary.count) : 0
                return (
                  <article key={method} className="chunk-card" style={{ cursor: "default" }}>
                    <div className="chunk-card-top">
                      <span className="status-chip idle" style={{ textTransform: "capitalize" }}>{method}</span>
                      <span className="status-chip success">{summary.count} chunks</span>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "12px" }}>
                      Avg length: {avgLength} chars
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}

        <div className="section-label">All Chunks ({chunks.length}/{total})</div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: "12px" }}>Loading chunks...</div>
        ) : (
          <div className="cards-grid">
            {chunks.map((chunk) => {
              const isExp = expandedIds.has(chunk.id)
              return (
                <article
                  key={chunk.id}
                  className={`chunk-card${isExp ? " expanded" : ""}`}
                  onClick={() => toggleExpand(chunk.id)}
                >
                  <div className="chunk-card-top">
                    <span className="status-chip idle">{chunk.filename || "unknown"}</span>
                    <span className="status-chip success">Chunk {chunk.chunk_index}</span>
                  </div>
                  <p className={`chunk-text${isExp ? " expanded" : ""}`}>{chunk.document || "(empty chunk)"}</p>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {chunk.chunk_method && (
                        <span className="status-chip idle" style={{ textTransform: "capitalize" }}>{chunk.chunk_method}</span>
                      )}
                      {Number.isFinite(chunk.chunk_length) && (
                        <span className="status-chip success">{chunk.chunk_length} chars</span>
                      )}
                    </div>
                    <span className="chunk-card-expand-hint" style={{ marginLeft: "auto" }}>{isExp ? "click to collapse" : "click to expand"}</span>
                  </div>
                </article>
              )
            })}
            {chunks.length === 0 && <div style={{ color: "var(--muted)", fontSize: "12px" }}>No chunks found.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

