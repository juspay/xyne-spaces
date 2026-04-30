/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_API_TIMEOUT: string;
  readonly VITE_KEYCLOAK_URL: string;
  readonly VITE_KEYCLOAK_REALM: string;
  readonly VITE_KEYCLOAK_CLIENT_ID: string;
  readonly VITE_LOG_LEVEL: string;
  readonly VITE_ENVIRONMENT: string;
  readonly VITE_ZERO_SERVER: string;
  readonly VITE_ENABLE_ANALYTICS: string;
  readonly VITE_ENABLE_WORKFLOW_EDITOR: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_GENIUS_API_KEY: string;
  readonly VITE_GENIUS_URL: string;
  readonly VITE_ENABLE_SUMMARY_ACTION_BUTTONS: string;
  readonly VITE_GRAFANA_URL: string;
  readonly VITE_GRAFANA_LOGS_DATASOURCE_ID: string;
  readonly VITE_APPS_PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;

declare module 'emoji-datasource/emoji.json' {
  export interface EmojiDatasourceEntry {
    short_name: string;
    short_names: string[];
    unified: string;
  }
  const data: EmojiDatasourceEntry[];
  export default data;
}
