import React from "react";
import { createRoot } from "react-dom/client";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import App from "./App.jsx";

// La app los busca aquí: importarlos así garantiza que quedan registrados
// en el puente nativo de Capacitor.
window.__cap = { Filesystem, Share };

createRoot(document.getElementById("root")).render(<App />);
