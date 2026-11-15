import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { applyLook, applyTheme, getLook, getTheme } from "./lib/theme";
// The brand's tokens and fonts, before Loskai's own CSS (vendored, unedited).
import "../vendor/simplysunde-ui/fonts.css";
import "../vendor/simplysunde-ui/simplysunde.css";
import "./index.css";

// Apply the saved theme and look before the first paint to avoid a flash of the wrong palette.
applyTheme(getTheme());
applyLook(getLook());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
