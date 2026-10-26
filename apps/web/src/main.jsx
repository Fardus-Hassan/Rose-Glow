import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "react-hot-toast"
import App from "./App.jsx"
import { ConfirmHost } from "./ui.jsx"
import "./styles.css"

document.addEventListener("wheel", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) {
    target.blur()
  }
}, { passive: true })

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
    <ConfirmHost />
    <Toaster
      position="top-center"
      containerStyle={{ top: 18 }}
      toastOptions={{
        duration: 2800,
        style: {
          background: "#1e1c1a",
          color: "#f7f2f0",
          border: "1px solid rgba(242, 209, 208, 0.28)",
          borderRadius: "999px",
          fontFamily: '"Noto Sans Bengali", "Nirmala UI", sans-serif',
        },
      }}
    />
  </StrictMode>,
)
