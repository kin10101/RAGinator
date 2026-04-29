import { useEffect, useState } from "react"
import axios from "axios"
import "../index.css"

function encodeFilePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

export default function FileDetail({ API, file, onClose, onRefresh, onEmbed }) {
  const [content, setContent] = useState("")
  const [newName, setNewName] = useState(file.filename)
  const encodedFilename = encodeFilePath(file.filename)

  useEffect(() => {
    setNewName(file.filename)
    axios
      .get(`${API}/files/${encodeFilePath(file.filename)}/content`)
      .then((res) => setContent(res.data.content))
      .catch((err) => {
        console.error(err)
        setContent("Unable to load document contents. May be a binary file or error occurred.")
      })
  }, [file, API])

  const handleRename = async () => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === file.filename) return
    try {
      await axios.patch(`${API}/files/${encodedFilename}?new_name=${encodeURIComponent(trimmed)}`)
      await onRefresh()
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${file.filename}"?`)) return
    try {
      await axios.delete(`${API}/files/${encodedFilename}`)
      await onRefresh()
      onClose()
    } catch (e) {
      console.error(e)
    }
  }

  const handleEmbed = async () => {
    await onEmbed?.(file.filename)
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              background: "transparent",
              border: "1px dashed transparent",
              color: "var(--text)",
              fontSize: "16px",
              fontWeight: 600,
              padding: "4px 8px",
              flex: 1,
              fontFamily: "var(--font)",
              outline: "none",
              transition: "border 0.2s",
            }}
            onFocus={(e) => (e.target.style.border = "1px dashed var(--border)")}
            onBlur={(e) => {
              e.target.style.border = "1px dashed transparent"
              handleRename()
            }}
            title="Click to rename"
          />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn-embed" onClick={handleEmbed} type="button">
            Chunk &amp; Embed
          </button>
          <button className="btn btn-danger" onClick={handleDelete} type="button">
            Delete
          </button>
          <button className="btn" onClick={onClose} type="button">
            ?
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "300px" }}>
        <div className="section-label" style={{ marginBottom: "8px" }}>Raw Content</div>
        <textarea
          value={content}
          readOnly
          style={{
            flex: 1,
            width: "100%",
            background: "var(--bg)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "16px",
            fontSize: "12px",
            fontFamily: "var(--mono)",
            lineHeight: 1.5,
            resize: "none",
            outline: "none",
          }}
        />
      </div>
    </div>
  )
}
