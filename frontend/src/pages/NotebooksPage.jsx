import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { useNavigate } from "react-router-dom"
import { API_BASE_URL } from "../utils/api"
import { useNotebooks } from "../context/NotebookProvider"
import StatusModal from "../components/StatusModal"

const API = API_BASE_URL

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
]

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "google_drive", label: "Google Drive" },
  { value: "github_repo", label: "GitHub Repo" },
]

const BLANK_DRAFT = { name: "", description: "", color: "#4f7cff", visibility: "private", source_type: "manual", source_url: "" }

function sourceLabel(sourceType) {
  if (sourceType === "google_drive") return "Google Drive"
  if (sourceType === "github_repo") return "GitHub Repo"
  return "Manual"
}

function NotebookFormModal({ open, draft, onChange, onSubmit, onClose, submitting, error }) {
  const nameRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    // Focus the name field when the modal opens
    setTimeout(() => nameRef.current?.focus(), 50)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)",
          borderRadius: "var(--radius)",
          padding: "24px 28px",
          width: "100%",
          maxWidth: "520px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--font)" }}>New Notebook</span>
          <button
            className="btn"
            type="button"
            onClick={onClose}
            style={{ padding: "2px 8px", fontSize: "16px", lineHeight: 1 }}
            aria-label="Close"
          >✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span className="section-label" style={{ marginBottom: 0 }}>Name</span>
            <input
              ref={nameRef}
              className="input"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="e.g. HR notebook"
              onKeyDown={(e) => { if (e.key === "Enter" && draft.name.trim()) onSubmit() }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span className="section-label" style={{ marginBottom: 0 }}>Description</span>
            <input
              className="input"
              value={draft.description}
              onChange={(e) => onChange({ ...draft, description: e.target.value })}
              placeholder="Short notes"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span className="section-label" style={{ marginBottom: 0 }}>Source</span>
            <select
              className="select"
              value={draft.source_type}
              onChange={(e) => onChange({ ...draft, source_type: e.target.value })}
            >
              {SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          {draft.source_type !== "manual" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span className="section-label" style={{ marginBottom: 0 }}>
                {draft.source_type === "google_drive" ? "Google Drive Folder URL" : "GitHub Repository URL"}
              </span>
              <input
                className="input"
                value={draft.source_url}
                onChange={(e) => onChange({ ...draft, source_url: e.target.value })}
                placeholder={
                  draft.source_type === "google_drive"
                    ? "https://drive.google.com/drive/folders/..."
                    : "https://github.com/owner/repo"
                }
              />
            </label>
          )}

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span className="section-label" style={{ marginBottom: 0 }}>Color</span>
              <input
                type="color"
                value={draft.color}
                onChange={(e) => onChange({ ...draft, color: e.target.value })}
                title="Notebook color"
                style={{ width: "36px", height: "32px", border: "none", background: "transparent", cursor: "pointer" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              <span className="section-label" style={{ marginBottom: 0 }}>Visibility</span>
              <select
                className="select"
                value={draft.visibility}
                onChange={(e) => onChange({ ...draft, visibility: e.target.value })}
              >
                {VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {error && (
          <div className="status-chip error" style={{ fontSize: "12px" }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button className="btn" type="button" onClick={onClose} style={{ minWidth: "72px" }}>Cancel</button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={onSubmit}
            disabled={submitting || !draft.name.trim()}
            style={{ minWidth: "80px" }}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}

function NotebookForm({ value, onChange, onSubmit, submitting, submitLabel }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "10px",
        alignItems: "end",
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        <span className="section-label" style={{ marginBottom: 0 }}>Name</span>
        <input
          className="input"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="e.g. HR notebook"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        <span className="section-label" style={{ marginBottom: 0 }}>Description</span>
        <input
          className="input"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="Short notes"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        <span className="section-label" style={{ marginBottom: 0 }}>Source</span>
        <select
          className="select"
          value={value.source_type}
          onChange={(e) => onChange({ ...value, source_type: e.target.value })}
          style={{ minWidth: "120px", width: "100%" }}
        >
          {SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {value.source_type !== "manual" && (
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
          <span className="section-label" style={{ marginBottom: 0 }}>
            {value.source_type === "google_drive" ? "Google Drive Folder URL" : "GitHub Repository URL"}
          </span>
          <input
            className="input"
            value={value.source_url}
            onChange={(e) => onChange({ ...value, source_url: e.target.value })}
            placeholder={
              value.source_type === "google_drive"
                ? "https://drive.google.com/drive/folders/..."
                : "https://github.com/owner/repo"
            }
          />
        </label>
      )}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
        <input
          type="color"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          title="Notebook color"
          style={{ width: "36px", height: "32px", border: "none", background: "transparent" }}
        />
        <select
          className="select"
          value={value.visibility}
          onChange={(e) => onChange({ ...value, visibility: e.target.value })}
          style={{ minWidth: "120px", width: "120px", flex: "0 0 auto" }}
        >
          {VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={onSubmit} disabled={submitting || !value.name.trim()} type="button">
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

export default function NotebooksPage() {
  const navigate = useNavigate()
  const { notebooks, refreshNotebooks, activeNotebookId, setActiveNotebookId } = useNotebooks()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState("")
  const [saving, setSaving] = useState(false)
  const [syncingId, setSyncingId] = useState("")
  const [error, setError] = useState("")
  const [modal, setModal] = useState(null)
  const [editDraft, setEditDraft] = useState({
    name: "",
    description: "",
    color: "#4f7cff",
    visibility: "private",
    source_type: "manual",
    source_url: "",
  })
  const [draft, setDraft] = useState(BLANK_DRAFT)

  const createNotebook = async () => {
    setSaving(true)
    setError("")
    try {
      await axios.post(`${API}/notebooks`, draft)
      await refreshNotebooks()
      setDraft(BLANK_DRAFT)
      setCreateOpen(false)
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create notebook")
    } finally {
      setSaving(false)
    }
  }

  const closeCreateModal = () => {
    setCreateOpen(false)
    setError("")
    setDraft(BLANK_DRAFT)
  }

  const updateNotebook = async (notebookId, value) => {
    setSaving(true)
    setError("")
    try {
      await axios.patch(`${API}/notebooks/${notebookId}`, value)
      await refreshNotebooks()
      setEditingId("")
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to update notebook")
    } finally {
      setSaving(false)
    }
  }

  const deleteNotebook = async (notebookId) => {
    setModal({
      status: "confirm",
      title: "Delete notebook",
      lines: [
        "This notebook and its associated files will be permanently deleted.",
        "Embedded chunks for those files will also be removed.",
      ],
      onConfirm: async () => {
        setModal(null)
        setSaving(true)
        setError("")
        try {
          await axios.delete(`${API}/notebooks/${notebookId}`)
          if (activeNotebookId === notebookId) setActiveNotebookId("")
          await refreshNotebooks()
        } catch (err) {
          setError(err?.response?.data?.detail || "Failed to delete notebook")
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const syncNotebook = async (notebook) => {
    setError("")
    setSyncingId(notebook.id)
    try {
      await axios.post(`${API}/notebooks/${notebook.id}/sync`, {})
      await refreshNotebooks()
      if (activeNotebookId !== notebook.id) {
        setActiveNotebookId(notebook.id)
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to sync notebook")
    } finally {
      setSyncingId("")
    }
  }

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <StatusModal
        open={!!modal}
        status={modal?.status}
        title={modal?.title}
        lines={modal?.lines}
        onClose={() => setModal(null)}
        onConfirm={modal?.onConfirm}
      />
      <NotebookFormModal
        open={createOpen}
        draft={draft}
        onChange={setDraft}
        onSubmit={createNotebook}
        onClose={closeCreateModal}
        submitting={saving}
        error={error}
      />
      <div className="topbar">
        <div className="topbar-title">Notebooks</div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)} type="button">
            New Notebook
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {error && !createOpen && <div className="status-chip error" style={{ width: "fit-content" }}>{error}</div>}

        <div className="cards-grid notebook-cards-grid">
          {notebooks.map((notebook) => {
            const isActive = notebook.id === activeNotebookId
            const isEditing = notebook.id === editingId
            const [namePart = "", ...rest] = (notebook.name || "").split(" ")
            const initials = `${namePart[0] || "N"}${(rest[0] || "")[0] || ""}`.toUpperCase()

            return (
              <article
                key={notebook.id}
                className="chunk-card"
                role="button"
                tabIndex={0}
                onClick={() => !isEditing && setActiveNotebookId(notebook.id)}
                onKeyDown={(e) => {
                  if (isEditing) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setActiveNotebookId(notebook.id)
                  }
                }}
                style={{
                  borderColor: isActive ? (notebook.color || "var(--accent)") : undefined,
                  boxShadow: isActive ? `0 0 0 2px ${notebook.color || "var(--accent)"}33` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: notebook.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 600, fontSize: "11px" }}>
                      {initials || "NB"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{notebook.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--muted)" }}>{notebook.description || "No description"}</div>
                    </div>
                  </div>
                  {isActive && <span className="status-chip success">Active</span>}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip idle">{notebook.file_count ?? (notebook.filenames || []).length} files</span>
                  <span className={`status-chip ${notebook.visibility === "public" ? "embedding" : "idle"}`}>
                    {notebook.visibility || "private"}
                  </span>
                  <span className={`status-chip ${notebook.source_type === "manual" ? "idle" : "embedding"}`}>
                    {sourceLabel(notebook.source_type)}
                  </span>
                  {notebook.sync_status && (
                    <span className={`status-chip ${notebook.sync_status === "ok" ? "success" : notebook.sync_status === "error" ? "error" : "idle"}`}>
                      Sync: {notebook.sync_status}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <NotebookForm
                      value={editDraft}
                      onChange={setEditDraft}
                      onSubmit={() => updateNotebook(notebook.id, editDraft)}
                      submitting={saving}
                      submitLabel="Save"
                    />
                    <div>
                      <button className="btn" onClick={() => setEditingId("")} type="button">Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="notebook-card-actions" style={{ marginTop: "4px" }}>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(notebook.id)
                        setEditDraft({
                          name: notebook.name || "",
                          description: notebook.description || "",
                          color: notebook.color || "#4f7cff",
                          visibility: notebook.visibility || "private",
                          source_type: notebook.source_type || "manual",
                          source_url: notebook.source_url || "",
                        })
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveNotebookId(notebook.id)
                        navigate("/files")
                      }}
                      type="button"
                    >
                      Files
                    </button>
                    {notebook.source_type !== "manual" && (
                      <button
                        className="btn btn-embed"
                        onClick={(e) => {
                          e.stopPropagation()
                          syncNotebook(notebook)
                        }}
                        disabled={syncingId === notebook.id || saving}
                        type="button"
                      >
                        {syncingId === notebook.id ? "Syncing..." : "Sync"}
                      </button>
                    )}
                    <button
                      className="btn btn-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteNotebook(notebook.id)
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                )}
                {notebook.source_type === "google_drive" && (
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "8px", lineHeight: 1.4 }}>
                    Public folder URL only in v1. {notebook.synced_at ? `Last sync: ${new Date(notebook.synced_at).toLocaleString()}` : "Not synced yet."}
                  </div>
                )}
                {notebook.source_type === "github_repo" && (
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "8px", lineHeight: 1.4 }}>
                    Public github.com repo URL only in v1. {notebook.synced_at ? `Last sync: ${new Date(notebook.synced_at).toLocaleString()}` : "Not synced yet."}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
