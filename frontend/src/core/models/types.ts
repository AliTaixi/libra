export interface Model {
  id: string;
  name: string;
  model: string;
  display_name: string;
  description?: string | null;
  use?: string;
  supports_vision?: boolean;
}

export interface TokenUsageSettings {
  enabled: boolean;
}

export interface ModelsResponse {
  models: Model[];
  token_usage: TokenUsageSettings;
}

export interface ModelCreateRequest {
  name: string;
  model: string;
  display_name?: string;
  description?: string;
  use?: string;
  api_key?: string;
  base_url?: string;
  supports_vision?: boolean;
}

export interface ModelUpdateRequest {
  model?: string;
  display_name?: string;
  description?: string;
  use?: string;
  api_key?: string;
  base_url?: string;
  supports_vision?: boolean;
}
