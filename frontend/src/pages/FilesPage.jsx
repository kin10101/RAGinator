import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import FileUpload from "../components/FileUpload"
import FileList from "../components/FileList"
import FileDetail from "../components/FileDetail"
import StatusModal from "../components/StatusModal"
import { API_BASE_URL } from "../utils/api"

const API = API_BASE_URL
const FALLBACK_CHUNKERS = [
  {
    id: "fixed",
    label: "Fixed Window",
    description: "Character-based chunks with overlap. Best for predictable chunk sizing.",
  },
  {
    id: "sentence",
    label: "Sentence",
    description: "Groups complete sentences into chunks for cleaner boundaries.",
  },
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Keeps paragraphs together when possible and falls back for oversized blocks.",
  },
  {
    id: "semantic",
    label: "Semantic",
    description: "Uses topic-shift scoring between neighboring sentences for more natural boundaries.",
  },
]

function parseIntOr(value, fallback) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) ? next : fallback
}

export default function FilesPage() {
  const [files, setFiles] = useState([])
  const [selectedFilename, setSelectedFilename] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [embedStatuses, setEmbedStatuses] = useState({})
  const [chunkSize, setChunkSize] = useState("800")
  const [overlap, setOverlap] = useState("120")
  const [chunkMethods, setChunkMethods] = useState(FALLBACK_CHUNKERS)
  const [selectedChunkMethod, setSelectedChunkMethod] = useState(FALLBACK_CHUNKERS[0].id)
  const [modal, setModal] = useState(null) // { status, title, lines, onConfirm? }

  const showModal = (status, title, lines, onConfirm = null) => setModal({ status, title, lines, onConfirm })

  const applyFileSnapshot = useCallback((nextFiles) => {
    setFiles(nextFiles)
    setSelectedFiles((prev) => prev.filter((name) => nextFiles.some((file) => file.filename === name)))
    setSelectedFilename((prev) => (prev && !nextFiles.some((file) => file.filename === prev) ? null : prev))
  }, [])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/files`)
      const nextFiles = [...res.data].sort((a, b) => a.filename.localeCompare(b.filename))
      applyFileSnapshot(nextFiles)
    } catch (err) {
      console.error("Failed to load files:", err)
    }
  }, [applyFileSnapshot])

  useEffect(() => {
    let isMounted = true

    axios.get(`${API}/files`).then((res) => {
      if (!isMounted) return
      const nextFiles = [...res.data].sort((a, b) => a.filename.localeCompare(b.filename))
      applyFileSnapshot(nextFiles)
    }).catch((err) => {
      console.error("Failed to load files:", err)
    })

    return () => {
      isMounted = false
    }
  }, [applyFileSnapshot])

  useEffect(() => {
    let isMounted = true

    axios.get(`${API}/chunkers`).then((res) => {
      if (!isMounted) return

      const items = Array.isArray(res.data?.items) && res.data.items.length ? res.data.items : FALLBACK_CHUNKERS
      const defaultMethod = typeof res.data?.default === "string" ? res.data.default : items[0]?.id

      setChunkMethods(items)
      setSelectedChunkMethod((prev) => {
        if (items.some((item) => item.id === prev)) return prev
        return items.some((item) => item.id === defaultMethod) ? defaultMethod : items[0]?.id || prev
      })
    }).catch((err) => {
      console.error("Failed to load chunkers:", err)
      if (!isMounted) return
      setChunkMethods(FALLBACK_CHUNKERS)
      setSelectedChunkMethod((prev) => prev || FALLBACK_CHUNKERS[0].id)
    })

    return () => {
      isMounted = false
    }
  }, [])

  const selected = selectedFilename ? files.find((f) => f.filename === selectedFilename) || null : null
  const allSelected = files.length > 0 && selectedFiles.length === files.length
  const selectedChunker = chunkMethods.find((item) => item.id === selectedChunkMethod) || chunkMethods[0] || FALLBACK_CHUNKERS[0]

  const toggleSelectFile = (filename) => {
    setSelectedFiles((prev) =>
      prev.includes(filename) ? prev.filter((n) => n !== filename) : [...prev, filename]
    )
  }

  const toggleSelectAll = () => {
    setSelectedFiles((prev) =>
      files.length > 0 && prev.length === files.length ? [] : files.map((f) => f.filename)
    )
  }

  const toggleSelectGroup = (filenames) => {
    setSelectedFiles((prev) => {
      const allIn = filenames.every((n) => prev.includes(n))
      if (allIn) return prev.filter((n) => !filenames.includes(n))
      const toAdd = filenames.filter((n) => !prev.includes(n))
      return [...prev, ...toAdd]
    })
  }

  const markEmbedStatus = (filenames, status) => {
    setEmbedStatuses((prev) => {
      const next = { ...prev }
      filenames.forEach((name) => { next[name] = status })
      return next
    })
  }

  const embedFiles = async (filenames) => {
    const chunkSizeValue = Math.max(50, parseIntOr(chunkSize, 800))
    const overlapValue = Math.max(0, parseIntOr(overlap, 120))
    markEmbedStatus(filenames, "embedding")
    try {
      const res = await axios.post(`${API}/files/embed`, {
        filenames,
        chunk_size: chunkSizeValue,
        overlap: overlapValue,
        chunk_method: selectedChunkMethod,
      })
      const successful = new Set((res.data.embedded_files || []).map((item) => item.filename))
      setEmbedStatuses((prev) => {
        const next = { ...prev }
        filenames.forEach((name) => { next[name] = successful.has(name) ? "success" : "error" })
        return next
      })
      await fetchFiles()
      return {
        ok: true,
        totalChunks: res.data.total_chunks || 0,
        chunkMethod: res.data.chunk_method || selectedChunkMethod,
      }
    } catch (err) {
      console.error("Embed failed:", err)
      markEmbedStatus(filenames, "error")
      return { ok: false }
    }
  }

  const handleBulkDelete = () => {
    if (!selectedFiles.length) return
    showModal(
      "confirm",
      "Delete files",
      [
        `${selectedFiles.length} file(s) will be permanently deleted.`,
        "Their embedded chunks will also be removed.",
      ],
      async () => {
        setModal(null)
        try {
          await axios.post(`${API}/files/bulk-delete`, { filenames: selectedFiles })
          setSelectedFiles([])
          await fetchFiles()
        } catch (err) {
          console.error("Bulk delete failed:", err)
          showModal("error", "Delete failed", ["Could not delete the selected files.", "Check backend logs for details."])
        }
      }
    )
  }

  const handleBulkEmbed = async () => {
    if (!selectedFiles.length) return
    const result = await embedFiles(selectedFiles)
    if (result.ok) {
      showModal("success", "Embedding complete", [
        `${selectedFiles.length} file(s) embedded`,
        `${selectedChunker.label} chunker used`,
        `${result.totalChunks} total chunks created`,
      ])
    } else {
      showModal("error", "Embedding failed", ["One or more files could not be embedded.", "Check backend logs for details."])
    }
  }

  const handleSingleEmbed = async (filename) => {
    const result = await embedFiles([filename])
    if (result.ok) {
      showModal("success", "Embedding complete", [
        `${filename}`,
        `${selectedChunker.label} chunker used`,
        `${result.totalChunks} chunk(s) created`,
      ])
    } else {
      showModal("error", "Embedding failed", [`Could not embed: ${filename}`, "Check backend logs for details."])
    }
  }

  return (
    <div className="page">
      <StatusModal
        open={!!modal}
        status={modal?.status}
        title={modal?.title}
        lines={modal?.lines}
        onClose={() => setModal(null)}
        onConfirm={modal?.onConfirm}
      />
      <div className="topbar">
        <div className="topbar-title">Files</div>
        <div
          style={{
            width: "1px",
            height: "20px",
            background: "var(--border2)",
            margin: "0 4px",
            flexShrink: 0,
          }}
        />
        <div className="chunk-controls">
          <label>
            Method
            <select
              className="select"
              value={selectedChunkMethod}
              onChange={(e) => setSelectedChunkMethod(e.target.value)}
              title={selectedChunker?.description || "Chunking method"}
              style={{ minWidth: "170px", height: "28px" }}
            >
              {chunkMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chunk size
            <input
              type="number"
              min="50"
              value={chunkSize}
              onChange={(e) => setChunkSize(e.target.value)}
              style={{ width: "72px" }}
            />
          </label>
          <label>
            Overlap
            <input
              type="number"
              min="0"
              value={overlap}
              onChange={(e) => setOverlap(e.target.value)}
              style={{ width: "64px" }}
            />
          </label>
        </div>
        <div className="topbar-actions">
          {selectedFiles.length > 0 && (
            <>
              <button className="btn btn-embed" onClick={handleBulkEmbed} type="button">
                Embed ({selectedFiles.length})
              </button>
              <button className="btn btn-danger" onClick={handleBulkDelete} type="button">
                Delete ({selectedFiles.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            width: "360px",
            borderRight: "1px solid var(--border)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <FileUpload API={API} onUpload={fetchFiles} />
          <div className="section-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            Uploaded Files ({selectedFiles.length}/{files.length})
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <FileList
              files={files}
              onSelect={(f) => setSelectedFilename(f.filename)}
              selectedFile={selected}
              selectedFiles={selectedFiles}
              onToggleSelect={toggleSelectFile}
              onToggleGroup={toggleSelectGroup}
              embedStatuses={embedStatuses}
            />
          </div>
        </div>

        

        <div
          style={{
            flex: 1,
            padding: "24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {selected ? (
            <FileDetail
              key={selected.filename}
              API={API}
              file={selected}
              onClose={() => setSelectedFilename(null)}
              onRefresh={fetchFiles}
              onEmbed={handleSingleEmbed}
            />
          ) : (
            <div style={{ margin: "auto", color: "var(--muted)", textAlign: "center" }}>
              <p style={{ fontSize: "14px", fontWeight: 500 }}>No file selected</p>
              <p style={{ fontSize: "12px", marginTop: "8px" }}>
                Select a document to preview it, then chunk and embed into the RAG vector store with {selectedChunker.label.toLowerCase()} mode.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
