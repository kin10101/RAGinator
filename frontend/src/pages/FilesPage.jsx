import { useState, useEffect, useCallback, useRef } from "react"
import axios from "axios"
import FileUpload from "../components/FileUpload"
import FileList from "../components/FileList"
import FileDetail from "../components/FileDetail"
import StatusModal from "../components/StatusModal"
import { API_BASE_URL } from "../utils/api"
import { useNotebooks } from "../context/NotebookProvider"

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
  {
    id: "markdown",
    label: "Heading-aware",
    description: "Splits around headings first, then chunks each section for cleaner document structure.",
  },
  {
    id: "adaptive",
    label: "Adaptive",
    description: "Auto-selects sentence, paragraph, or semantic chunking based on document shape.",
  },
]

function encodeFilePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function parseIntOr(value, fallback) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) ? next : fallback
}

const MIN_LEFT = 240
const MAX_LEFT = 640

export default function FilesPage() {
  const { activeNotebook, refreshNotebooks } = useNotebooks()
  const [files, setFiles] = useState([])
  const [leftWidth, setLeftWidth] = useState(360)
  const dragging = useRef(false)

  const onPanelDragStart = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = leftWidth
    const onMove = (ev) => {
      if (!dragging.current) return
      setLeftWidth(Math.min(MAX_LEFT, Math.max(MIN_LEFT, startW + ev.clientX - startX)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [leftWidth])
  const [selectedFilename, setSelectedFilename] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [embedStatuses, setEmbedStatuses] = useState({})
  const [chunkSize, setChunkSize] = useState("800")
  const [overlap, setOverlap] = useState("120")
  const [chunkMethods, setChunkMethods] = useState(FALLBACK_CHUNKERS)
  const [selectedChunkMethod, setSelectedChunkMethod] = useState(FALLBACK_CHUNKERS[0].id)
  const [modal, setModal] = useState(null) // { status, title, lines, onConfirm? }
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  useEffect(() => {
    if (!activeNotebook) return
    setSelectedFiles((prev) => prev.filter((name) => (activeNotebook.filenames || []).includes(name)))
    setSelectedFilename((prev) => {
      if (!prev) return prev
      return (activeNotebook.filenames || []).includes(prev) ? prev : null
    })
  }, [activeNotebook])

  useEffect(() => {
    if (!activeNotebook) return
    fetchFiles()
  }, [activeNotebook, fetchFiles])

  const visibleFiles = activeNotebook
    ? files.filter((file) => (activeNotebook.filenames || []).includes(file.filename))
    : []
  const selected = selectedFilename ? visibleFiles.find((f) => f.filename === selectedFilename) || null : null
  const visibleNames = new Set(visibleFiles.map((file) => file.filename))
  const selectedVisibleCount = selectedFiles.filter((name) => visibleNames.has(name)).length
  const allSelected = visibleFiles.length > 0 && selectedVisibleCount === visibleFiles.length
  const selectedChunker = chunkMethods.find((item) => item.id === selectedChunkMethod) || chunkMethods[0] || FALLBACK_CHUNKERS[0]

  const toggleSelectFile = (filename) => {
    setSelectedFiles((prev) =>
      prev.includes(filename) ? prev.filter((n) => n !== filename) : [...prev, filename]
    )
  }

  const toggleSelectAll = () => {
    setSelectedFiles(() =>
      visibleFiles.length > 0 && selectedVisibleCount === visibleFiles.length ? [] : visibleFiles.map((f) => f.filename)
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
    setModal({
      status: "loading",
      title: "Embedding in progress",
      lines: [
        `${filenames.length} file(s) are being chunked and embedded.`,
        "Please wait while vectors are generated.",
      ],
    })
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
    } finally {
      setModal(null)
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

  const handlePreviewSelected = async () => {
    if (!selectedFilename) {
      showModal("error", "No file selected", ["Pick a file first, then preview its chunks."])
      return
    }

    const chunkSizeValue = Math.max(50, parseIntOr(chunkSize, 800))
    const overlapValue = Math.max(0, parseIntOr(overlap, 120))
    try {
      const res = await axios.post(`${API}/files/${encodeFilePath(selectedFilename)}/chunks`, null, {
        params: {
          chunk_size: chunkSizeValue,
          overlap: overlapValue,
          chunk_method: selectedChunkMethod,
        },
      })
      const chunks = Array.isArray(res.data?.chunks) ? res.data.chunks : []
      const stats = res.data?.stats || {}
      const preview = chunks.slice(0, 3).map((chunk, index) => {
        const clipped = chunk.length > 180 ? `${chunk.slice(0, 180)}...` : chunk
        return `${index + 1}. ${clipped}`
      })

      showModal("success", "Chunk preview", [
        `File: ${selectedFilename}`,
        `Method: ${selectedChunker.label}`,
        `Chunks: ${stats.count ?? chunks.length} | Avg length: ${stats.avg_length ?? 0} chars | Median: ${stats.median_length ?? 0} chars`,
        ...preview,
      ])
    } catch (err) {
      console.error("Chunk preview failed:", err)
      showModal("error", "Chunk preview failed", ["Could not generate preview chunks.", "Check backend logs for details."])
    }
  }

  const handleUpload = async (uploadedFilenames = []) => {
    if (!activeNotebook) {
      showModal("error", "No notebook selected", ["Select a notebook first.", "Uploads are assigned to the active notebook."])
      return
    }

    if (uploadedFilenames.length) {
      try {
        await axios.post(`${API}/notebooks/${activeNotebook.id}/files`, { filenames: uploadedFilenames })
        await refreshNotebooks()
      } catch (err) {
        console.error("Failed to assign files to notebook:", err)
      }
    }
    await fetchFiles()
  }

  return (
    <div className="page">
      <StatusModal
        open={!!modal}
        status={modal?.status}
        title={modal?.title}
        lines={modal?.lines}
        onClose={modal?.status === "loading" ? undefined : () => setModal(null)}
        onConfirm={modal?.onConfirm}
      />
      <div className="topbar">
        <div className="topbar-title">Files</div>
        {activeNotebook ? (
          <span className="status-chip embedding" title="Active notebook">
            Notebook: {activeNotebook.name}
          </span>
        ) : (
          <span className="status-chip error" title="Select a notebook from the Notebooks page">
            No notebook selected
          </span>
        )}
        <div className="topbar-actions">
          <button
            className={`btn ${settingsOpen ? "btn-primary" : ""}`}
            onClick={() => setSettingsOpen((open) => !open)}
            type="button"
          >
            Chunk Settings
          </button>
          <button className="btn" type="button" onClick={handlePreviewSelected} disabled={!selectedFilename}>
            Preview Selected
          </button>
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
            width: leftWidth,
            borderRight: "1px solid var(--border)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <FileUpload API={API} onUpload={handleUpload} disabled={!activeNotebook} />
          <div className="section-label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            Uploaded Files ({selectedVisibleCount}/{visibleFiles.length})
          </div>
          {!activeNotebook && (
            <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "8px" }}>
              Select a notebook on the Notebooks page to view and upload files.
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <FileList
              files={visibleFiles}
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
          onMouseDown={onPanelDragStart}
          style={{
            width: "4px",
            flexShrink: 0,
            cursor: "col-resize",
            background: "transparent",
            position: "relative",
            zIndex: 10,
          }}
          className="panel-resizer"
        />

        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            position: "relative",
            flexDirection: "column",
          }}
        >
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

          {settingsOpen ? (
            <aside className="files-settings-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="section-label" style={{ marginBottom: 0 }}>Chunk Settings</span>
                <button className="btn" type="button" onClick={() => setSettingsOpen(false)}>Close</button>
              </div>
              <div className="chunk-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }}>
                <label style={{ justifyContent: "space-between" }}>
                  Method
                  <select
                    className="select"
                    value={selectedChunkMethod}
                    onChange={(e) => setSelectedChunkMethod(e.target.value)}
                    title={selectedChunker?.description || "Chunking method"}
                    style={{ minWidth: "100%", height: "32px" }}
                  >
                    {chunkMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ justifyContent: "space-between" }}>
                  Chunk size
                  <input
                    type="number"
                    min="50"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ justifyContent: "space-between" }}>
                  Overlap
                  <input
                    type="number"
                    min="0"
                    value={overlap}
                    onChange={(e) => setOverlap(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </label>
                <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.5 }}>
                  {selectedChunker?.description}
                </div>
              </div>
            </aside>
          ) : (
            <button className="files-settings-tab" type="button" onClick={() => setSettingsOpen(true)}>
              Chunk Settings
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
