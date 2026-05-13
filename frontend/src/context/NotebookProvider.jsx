import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "../utils/api"

const API = API_BASE_URL
const STORAGE_KEY = "raginator.activeNotebookId"

const NotebookContext = createContext(null)

export function NotebookProvider({ children }) {
  const [notebooks, setNotebooks] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(() => localStorage.getItem(STORAGE_KEY) || "")
  const [loading, setLoading] = useState(false)

  const refreshNotebooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API}/notebooks`)
      const nextNotebooks = Array.isArray(res.data?.notebooks) ? res.data.notebooks : []
      setNotebooks(nextNotebooks)
      return nextNotebooks
    } catch (err) {
      console.error("Failed to load notebooks:", err)
      setNotebooks([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshNotebooks()
  }, [refreshNotebooks])

  useEffect(() => {
    if (!activeNotebookId) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, activeNotebookId)
  }, [activeNotebookId])

  useEffect(() => {
    if (!activeNotebookId) return
    if (notebooks.some((notebook) => notebook.id === activeNotebookId)) return
    setActiveNotebookId("")
  }, [notebooks, activeNotebookId])

  const activeNotebook = useMemo(
    () => notebooks.find((notebook) => notebook.id === activeNotebookId) || null,
    [notebooks, activeNotebookId],
  )

  const value = useMemo(
    () => ({
      notebooks,
      loading,
      activeNotebook,
      activeNotebookId,
      setActiveNotebookId,
      setActiveNotebook: (notebook) => setActiveNotebookId(notebook?.id || ""),
      clearActiveNotebook: () => setActiveNotebookId(""),
      refreshNotebooks,
    }),
    [notebooks, loading, activeNotebook, activeNotebookId, refreshNotebooks],
  )

  return <NotebookContext.Provider value={value}>{children}</NotebookContext.Provider>
}

export function useNotebooks() {
  const value = useContext(NotebookContext)
  if (!value) {
    throw new Error("useNotebooks must be used inside NotebookProvider")
  }
  return value
}
