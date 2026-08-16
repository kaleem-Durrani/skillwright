/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the default `/api/v1` base. Only set when not on a single origin. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
