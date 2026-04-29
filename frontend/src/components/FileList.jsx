import "../index.css"

function getIconClass(filename) {
  const ext = filename.split(".").pop().toLowerCase()
  if (ext === "pdf") return "pdf"
  if (["doc", "docx"].includes(ext)) return "docx"
  if (["txt", "md"].includes(ext)) return "txt"
  return "code"
}

function getStatusChip({ file, embedStatuses }) {
  const localStatus = embedStatuses?.[file.filename]
  if (localStatus === "embedding") return { label: "Embedding", className: "status-chip embedding" }
  if (localStatus === "error") return { label: "Failed", className: "status-chip error" }
  if (file.chunk_count > 0) return { label: `${file.chunk_count} chunks`, className: "status-chip success" }
  return { label: "Not embedded", className: "status-chip idle" }
}

function FileRow({ f, onSelect, selectedFile, selectedFiles, onToggleSelect, embedStatuses }) {
  const isSelected = selectedFile?.filename === f.filename
  const isChecked = selectedFiles.includes(f.filename)
  const iconClass = getIconClass(f.filename)
  const ext = f.filename.split(".").pop().toUpperCase()
  const chip = getStatusChip({ file: f, embedStatuses })

  return (
    <div
      onClick={() => onSelect(f)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 12px",
        borderRadius: "var(--radius)",
        cursor: "pointer",
        background: isSelected ? "rgba(79,124,255,0.07)" : "transparent",
        border: `1px solid ${isSelected ? "rgba(79,124,255,0.2)" : "transparent"}`,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent"
      }}
    >
      <input
        type="checkbox"
        checked={isChecked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleSelect?.(f.filename)}
      />
      <div className={`file-icon ${iconClass}`}>{ext.slice(0, 4)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "12px",
            fontWeight: isSelected ? 600 : 500,
            color: isSelected ? "var(--text)" : "var(--muted)",
          }}
        >
          {f.filename}
        </div>
        <div style={{ marginTop: "4px" }}>
          <span className={chip.className}>{chip.label}</span>
        </div>
      </div>
    </div>
  )
}

export default function FileList({
  files,
  onSelect,
  selectedFile,
  selectedFiles = [],
  onToggleSelect,
  onToggleGroup,
  embedStatuses = {},
}) {
  if (!files || files.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: "12px", padding: "8px 0" }}>
        No files uploaded yet.
      </div>
    )
  }

  const isEmbedded = (f) => {
    const local = embedStatuses?.[f.filename]
    if (local === "success") return true
    if (local === "embedding" || local === "error") return false
    return f.chunk_count > 0
  }

  const embedded = files.filter(isEmbedded)
  const notEmbedded = files.filter((f) => !isEmbedded(f))

  const rowProps = { onSelect, selectedFile, selectedFiles, onToggleSelect, embedStatuses }

  const SectionCheckbox = ({ group }) => {
    const allChecked = group.length > 0 && group.every((f) => selectedFiles.includes(f.filename))
    const someChecked = !allChecked && group.some((f) => selectedFiles.includes(f.filename))
    return (
      <input
        type="checkbox"
        checked={allChecked}
        ref={(el) => { if (el) el.indeterminate = someChecked }}
        onChange={() => onToggleGroup?.(group.map((f) => f.filename))}
        onClick={(e) => e.stopPropagation()}
        style={{ marginRight: "6px", verticalAlign: "middle" }}
      />
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {notEmbedded.length > 0 && (
        <div>
          <div className="section-label" style={{ marginBottom: "6px", display: "flex", alignItems: "center" }}>
            <SectionCheckbox group={notEmbedded} />
            Not embedded ({notEmbedded.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {notEmbedded.map((f) => <FileRow key={f.filename} f={f} {...rowProps} />)}
          </div>
        </div>
      )}

      {embedded.length > 0 && (
        <div>
          <div
            className="section-label"
            style={{ marginBottom: "6px", color: "var(--accent2)", display: "flex", alignItems: "center" }}
          >
            <SectionCheckbox group={embedded} />
            Embedded ({embedded.length})
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              borderLeft: "2px solid rgba(56,217,169,0.25)",
              paddingLeft: "8px",
            }}
          >
            {embedded.map((f) => <FileRow key={f.filename} f={f} {...rowProps} />)}
          </div>
        </div>
      )}
    </div>
  )
}
