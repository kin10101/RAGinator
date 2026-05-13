import { Routes, Route, NavLink } from "react-router-dom"
import { useState, useCallback, useRef } from "react"
import FilesPage from "./pages/FilesPage"
import ChunksPage from "./pages/ChunksPage"
import ChatPage from "./pages/ChatPage"
import NotebooksPage from "./pages/NotebooksPage"
import { useNotebooks } from "./context/NotebookProvider"

const FileIcon = () => (
  <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5" height="6" rx="1" fill="currentColor" opacity="0.7" />
    <rect x="9" y="2" width="5" height="4" rx="1" fill="currentColor" />
    <rect x="2" y="10" width="12" height="4" rx="1" fill="currentColor" opacity="0.4" />
  </svg>
)

const ChunksIcon = () => (
  <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.8" />
    <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
    <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
    <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.8" />
  </svg>
)

const ChatIcon = () => (
  <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
    <path d="M2 3h12v8H9l-3 2v-2H2V3z" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
)

const ContextIcon = () => (
  <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="5" cy="8" r="1.1" fill="currentColor" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" opacity="0.75" />
    <circle cx="11" cy="8" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
)

const MIN_WIDTH = 140
const MAX_WIDTH = 400

const COLLAPSED_WIDTH = 48

export default function App() {
  const { activeNotebook } = useNotebooks()
  const [sidebarWidth, setSidebarWidth] = useState(210)
  const [collapsed, setCollapsed] = useState(false)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e) => {
    if (collapsed) return
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev) => {
      if (!dragging.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX))
      setSidebarWidth(next)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [collapsed, sidebarWidth])

  return (
    <div className="app-shell">
      <nav className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`} style={{ width: collapsed ? COLLAPSED_WIDTH : sidebarWidth }}>
        <div className="sidebar-brand">
          {!collapsed && <>Doc<span>talk</span></>}
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d={collapsed ? "M5 3l6 5-6 5" : "M11 3L5 8l6 5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} title="Notebook Select">
          <ContextIcon /> {!collapsed && "Notebook Select"}
        </NavLink>
        <NavLink to="/files" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} title="Files">
          <FileIcon /> {!collapsed && "Files"}
        </NavLink>
        <NavLink to="/chunks" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} title="Chunks">
          <ChunksIcon /> {!collapsed && "Chunks"}
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} title="Chat">
          <ChatIcon /> {!collapsed && "Chat"}
        </NavLink>
        {!collapsed && activeNotebook && (
          <div className="sidebar-notebook-chip" title={activeNotebook.name}>
            Notebook: {activeNotebook.name}
          </div>
        )}
        {!collapsed && <div className="sidebar-footer">Talk to your Documents!
          Made by Don 😎</div>}
      </nav>
      <div className="sidebar-resizer" onMouseDown={onMouseDown} />
      <Routes>
        <Route path="/" element={<NotebooksPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/chunks" element={<ChunksPage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </div>
  )
}
