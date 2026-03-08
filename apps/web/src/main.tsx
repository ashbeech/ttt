import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.scss";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/Overview";
import { MetricsPage } from "./pages/Metrics";
import { LineagePage } from "./pages/Lineage";
import { WalletsPage } from "./pages/Wallets";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route path="/lineage" element={<LineagePage />} />
          <Route path="/wallets" element={<WalletsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
