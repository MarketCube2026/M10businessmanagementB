import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./system.css";
import "./manager.css";
import "./business-nav.css";
import "./customer-layout.css";
createRoot(document.getElementById("root")!).render(<App />);
