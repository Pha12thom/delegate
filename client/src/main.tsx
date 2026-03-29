import React from "react";
import ReactDOM from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App";
import "./index.css";

const rawDomain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

const domain = ((rawDomain ?? "").replace(/^https?:\/\//, "").trim() || "milugo.us.auth0.com");

const missingEnv = [
  ["VITE_AUTH0_CLIENT_ID", clientId],
  ["VITE_AUTH0_AUDIENCE", audience],
].filter(([, value]) => !value);

if (missingEnv.length > 0) {
  const missingKeys = missingEnv.map(([key]) => key).join(", ");
  throw new Error(
    `Missing required Auth0 env vars in client/.env: ${missingKeys}`
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience,
        scope: "openid profile email offline_access",
      }}
      useRefreshTokens
      cacheLocation="localstorage"
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>
);
