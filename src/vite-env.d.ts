/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Port the API server listens on during local dev (default 8090). */
  readonly VITE_API_PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
