import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
// docs/07 §4.2：createRoot 从 react-dom/client 导入；禁止 ReactDOM.render。
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { queryClient } from "./app/queryClient";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
