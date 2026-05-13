import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { NotebookProvider } from "./context/NotebookProvider"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NotebookProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </NotebookProvider>
  </StrictMode>,
)
