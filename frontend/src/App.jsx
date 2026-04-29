import { Routes, Route, NavLink } from "react-router-dom"
import FilesPage from "./pages/FilesPage"
import ChunksPage from "./pages/ChunksPage"
import ChatPage from "./pages/ChatPage"

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

export default function App() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-brand">RAG<span>ginator</span></div>
        <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <FileIcon /> Files
        </NavLink>
        <NavLink to="/chunks" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <ChunksIcon /> Chunks
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <ChatIcon /> Chat
        </NavLink>
        <div className="sidebar-footer">Knowledge base</div>
      </nav>
      <Routes>
        <Route path="/" element={<FilesPage />} />
        <Route path="/chunks" element={<ChunksPage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </div>
  )
}
