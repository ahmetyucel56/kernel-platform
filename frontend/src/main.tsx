import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./styles/theme.css";

// Hata takibi: yalnızca Vercel'de VITE_SENTRY_DSN tanımlıysa açılır. Kişisel veri gönderilmez.
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div className="container" style={{ padding: 40 }}>
          <h2>Bir şeyler ters gitti.</h2>
          <p className="muted">Hata kaydedildi. Sayfayı yenilemeyi dene.</p>
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
