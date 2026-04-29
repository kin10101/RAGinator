import { useRef, useState } from "react"
import axios from "axios"
import { ACCEPTED_TYPES } from "../utils/fileHelpers"

function mapFilesWithRelativePaths(fileList) {
  return Array.from(fileList || []).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }))
}

export default function FileUpload({ API, onUpload }) {
  const filesInputRef = useRef()
  const folderInputRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const uploadBatch = async (entries) => {
    if (!entries.length) return
    setUploading(true)
    try {
      const form = new FormData()
      entries.forEach(({ file, relativePath }) => {
        form.append("files", file)
        form.append("relative_paths", relativePath)
      })
      await axios.post(`${API}/files/batch`, form)
      await onUpload()
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    uploadBatch(mapFilesWithRelativePaths(e.dataTransfer.files))
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      style={{
        border: "1px dashed var(--border2)",
        borderRadius: "var(--radius)",
        padding: "20px 16px",
        textAlign: "center",
        marginBottom: "16px",
        background: dragOver ? "rgba(79,124,255,0.05)" : "transparent",
        transition: "all 0.15s",
      }}
    >
      <div className="section-label" style={{ marginBottom: 6 }}>
        {uploading ? "Uploading..." : "Drop files/folder or use buttons"}
      </div>
      <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "8px" }}>
        <button
          className="btn btn-primary"
          onClick={() => filesInputRef.current?.click()}
          disabled={uploading}
          type="button"
        >
          Upload Files
        </button>
        <button
          className="btn"
          onClick={() => folderInputRef.current?.click()}
          disabled={uploading}
          type="button"
        >
          Upload Folder
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>PDF � DOCX � TXT � code files</div>
      <input
        ref={filesInputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPTED_TYPES}
        onChange={(e) => uploadBatch(mapFilesWithRelativePaths(e.target.files))}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        multiple
        webkitdirectory=""
        directory=""
        onChange={(e) => uploadBatch(mapFilesWithRelativePaths(e.target.files))}
      />
    </div>
  )
}
