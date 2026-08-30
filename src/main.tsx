import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import LandingPage from "./pages/LandingPage";
import PhotoUpload from "./pages/PhotoUpload";
import Exchange from "./pages/Exchange";
import Review from "./pages/Review";
import Report from "./pages/Report";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/match-result/:id" element={<PhotoUpload />} />
          <Route path="/match-result/:id/exchange" element={<Exchange />} />
          <Route path="/match-result/:id/review" element={<Review />} />
          <Route path="/match-result/:id/report" element={<Report />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>
);
