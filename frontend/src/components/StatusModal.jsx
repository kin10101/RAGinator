import { useEffect } from "react"

/**
 * StatusModal
 * Props:
 *   open      – boolean
 *   status    – "success" | "error" | "info" | "confirm"
 *   title     – string
 *   lines     – string[]  (body lines)
 *   onClose   – () => void
 *   onConfirm – () => void  (when set, shows Confirm + Cancel instead of OK)
 */
export default function StatusModal({ open, status = "info", title, lines = [], onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === "Escape") onClose?.() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const accent =
    status === "success" ? "var(--accent2)" :
    status === "error"   ? "var(--danger)"  :
                           "var(--accent)"

  const icon =
    status === "success" ? (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="10" stroke={accent} strokeWidth="1.5" />
        <path d="M6.5 11.5l3 3 6-6" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : status === "error" ? (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="10" stroke={accent} strokeWidth="1.5" />
        <path d="M8 8l6 6M14 8l-6 6" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ) : (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="10" stroke={accent} strokeWidth="1.5" />
        <path d="M11 10v5" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="11" cy="7.5" r="0.75" fill={accent} />
      </svg>
    )

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
          border: `1px solid var(--border)`,
          borderTop: `2px solid ${accent}`,
          borderRadius: "var(--radius)",
          padding: "24px 28px",
          minWidth: "320px",
          maxWidth: "480px",
          width: "100%",
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {icon}
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--font)" }}>{title}</span>
        </div>

        {lines.length > 0 && (
          <ul style={{ margin: 0, padding: "0 0 0 4px", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {lines.map((line, i) => (
              <li key={i} style={{ fontSize: "12px", color: "var(--muted)", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <span style={{ color: accent, flexShrink: 0, marginTop: "1px" }}>›</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          {onConfirm ? (
            <>
              <button className="btn" type="button" onClick={onClose} style={{ minWidth: "72px" }}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={onConfirm} style={{ minWidth: "72px" }}>
                Delete
              </button>
            </>
          ) : (
            <button className="btn btn-primary" type="button" onClick={onClose} style={{ minWidth: "72px" }}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
