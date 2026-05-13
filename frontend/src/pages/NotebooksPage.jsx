import { useState } from "react"
import axios from "axios"
import { useNavigate } from "react-router-dom"
import { API_BASE_URL } from "../utils/api"
import { useNotebooks } from "../context/NotebookProvider"

const API = API_BASE_URL

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
]

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
  const [error, setError] = useState("")
  const [editDraft, setEditDraft] = useState({ name: "", description: "", color: "#4f7cff", visibility: "private" })
  const [draft, setDraft] = useState({ name: "", description: "", color: "#4f7cff", visibility: "private" })

  const createNotebook = async () => {
    setSaving(true)
    setError("")
    try {
      await axios.post(`${API}/notebooks`, draft)
      await refreshNotebooks()
      setDraft({ name: "", description: "", color: "#4f7cff", visibility: "private" })
      setCreateOpen(false)
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create notebook")
    } finally {
      setSaving(false)
    }
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
    if (!window.confirm("Delete this notebook? Files will remain available.")) return
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
  }

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <div className="topbar">
        <div className="topbar-title">Notebook Select</div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setCreateOpen((v) => !v)} type="button">
            {createOpen ? "Close" : "New Notebook"}
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {createOpen && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px", background: "var(--surface)" }}>
            <NotebookForm
              value={draft}
              onChange={setDraft}
              onSubmit={createNotebook}
              submitting={saving}
              submitLabel="Create"
            />
          </div>
        )}

        {error && <div className="status-chip error" style={{ width: "fit-content" }}>{error}</div>}

        <div className="cards-grid">
          {notebooks.map((notebook) => {
            const isActive = notebook.id === activeNotebookId
            const isEditing = notebook.id === editingId
            const [namePart = "", ...rest] = (notebook.name || "").split(" ")
            const initials = `${namePart[0] || "N"}${(rest[0] || "")[0] || ""}`.toUpperCase()

            return (
              <article
                key={notebook.id}
                className="chunk-card"
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
                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <button className={`btn ${isActive ? "btn-primary" : ""}`} onClick={() => setActiveNotebookId(notebook.id)} type="button">
                      {isActive ? "Selected" : "Select"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setEditingId(notebook.id)
                        setEditDraft({
                          name: notebook.name || "",
                          description: notebook.description || "",
                          color: notebook.color || "#4f7cff",
                          visibility: notebook.visibility || "private",
                        })
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setActiveNotebookId(notebook.id)
                        navigate("/files")
                      }}
                      type="button"
                    >
                      Files
                    </button>
                    <button className="btn btn-danger" onClick={() => deleteNotebook(notebook.id)} type="button">Delete</button>
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
