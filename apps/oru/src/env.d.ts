interface ImportMetaEnv {
  /** The host this app is a client of, when it is not the origin serving it. */
  readonly VITE_ORU_HOST_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
