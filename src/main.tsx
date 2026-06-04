import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/themes/day.css";
import "./styles/themes/night.css";
import "./styles/mermaid.css";
import "./styles/math.css";
import "./styles/outline-flash.css";
import "katex/dist/katex.min.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
