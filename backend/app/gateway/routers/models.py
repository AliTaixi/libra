import logging
import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.gateway.deps import get_config, require_min_role
from deerflow.config.app_config import AppConfig, get_app_config, reload_app_config
from deerflow.config.model_config import ModelConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["models"])


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    use: str = Field(default="langchain_openai:ChatOpenAI", description="Provider class path")
    supports_vision: bool = Field(default=False, description="Whether the model supports vision")



class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models(config: AppConfig = Depends(get_config)) -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys and internal configuration.

    Returns:
        A list of all configured models with their metadata and token usage display settings.

    Example Response:
        ```json
        {
            "models": [
                {
                    "name": "gpt-4",
                    "model": "gpt-4",
                    "display_name": "GPT-4",
                    "description": "OpenAI GPT-4 model",
                    "supports_thinking": false,
                    "supports_reasoning_effort": false
                },
                {
                    "name": "claude-3-opus",
                    "model": "claude-3-opus",
                    "display_name": "Claude 3 Opus",
                    "description": "Anthropic Claude 3 Opus model",
                    "supports_thinking": true,
                    "supports_reasoning_effort": false
                }
            ],
            "token_usage": {
                "enabled": true
            }
        }
        ```
    """
    models = [
        ModelResponse(
            name=model.name,
            model=model.model,
            display_name=model.display_name,
            description=model.description,
            use=model.use,
            supports_vision=model.supports_vision,
        )
        for model in config.models
    ]
    return ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
    )


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(model_name: str, config: AppConfig = Depends(get_config)) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found.

    Example Response:
        ```json
        {
            "name": "gpt-4",
            "display_name": "GPT-4",
            "description": "OpenAI GPT-4 model",
            "supports_thinking": false
        }
        ```
    """
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    return ModelResponse(
        name=model.name,
        model=model.model,
        display_name=model.display_name,
        description=model.description,
        use=model.use,
        supports_vision=model.supports_vision,
    )


# ---------------------------------------------------------------------------
# CRUD helpers – persist model changes to config.yaml
# ---------------------------------------------------------------------------


def _get_config_path() -> Path:
    """Resolve the active config.yaml path."""
    return AppConfig.resolve_config_path()


def _load_config_yaml() -> tuple[dict, Path]:
    """Load the current config.yaml as a mutable dict."""
    path = _get_config_path()
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data, path


def _save_config_yaml(data: dict, path: Path) -> None:
    """Write a config dict back to config.yaml."""
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _resolve_env_var(value: str) -> str:
    """If value looks like an env var reference ($NAME), resolve it, otherwise return as-is."""
    if value.startswith("$"):
        return os.getenv(value[1:], "")
    return value


# ---------------------------------------------------------------------------
# Request / Response schemas for CRUD
# ---------------------------------------------------------------------------


class ModelCreateRequest(BaseModel):
    """Request body for creating a new model."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Provider model identifier (e.g. gpt-4o)")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    use: str = Field(default="langchain_openai:ChatOpenAI", description="Provider class path")
    api_key: str | None = Field(None, description="API key (will be stored as env var reference)")
    base_url: str | None = Field(None, description="Custom API base URL")
    supports_vision: bool = Field(default=False, description="Whether the model supports vision")


class ModelUpdateRequest(BaseModel):
    """Request body for updating an existing model."""

    model: str | None = Field(None, description="Provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    use: str | None = Field(None, description="Provider class path")
    api_key: str | None = Field(None, description="API key (will be stored as env var reference)")
    base_url: str | None = Field(None, description="Custom API base URL")
    supports_vision: bool | None = Field(None, description="Whether the model supports vision")


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/models",
    response_model=ModelResponse,
    status_code=201,
    summary="Create Model",
    description="Add a new AI model to the configuration.",
)
async def create_model(body: ModelCreateRequest, request: Request) -> ModelResponse:
    """Create a new model and persist it to config.yaml. Super admin only."""
    await require_min_role(request, "super")
    cfg: AppConfig = get_config(request)

    # Check for duplicate name
    if cfg.get_model_config(body.name) is not None:
        raise HTTPException(status_code=409, detail=f"Model '{body.name}' already exists")

    # Build model entry
    entry: dict = {
        "name": body.name,
        "model": body.model,
        "display_name": body.display_name or body.name,
        "use": body.use,
        "supports_vision": body.supports_vision,
    }
    if body.description:
        entry["description"] = body.description
    if body.api_key:
        env_key = f"{body.name.upper()}_API_KEY"
        entry["api_key"] = f"${env_key}"
    if body.base_url:
        entry["base_url"] = body.base_url

    try:
        # Persist to config.yaml
        config_data, config_path = _load_config_yaml()
        config_data.setdefault("models", []).append(entry)
        _save_config_yaml(config_data, config_path)

        if body.api_key:
            _write_env_var(env_key, body.api_key)

        # Reload config from file to sync singleton + app.state
        reload_app_config(str(config_path))
        request.app.state.config = get_app_config()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create model")
        raise HTTPException(status_code=500, detail=f"Failed to create model: {e!s}")

    return ModelResponse(
        name=body.name,
        model=body.model,
        display_name=body.display_name or body.name,
        description=body.description,
        use=body.use,
        supports_vision=body.supports_vision,
    )


@router.put(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Update Model",
    description="Update an existing AI model configuration.",
)
async def update_model(model_name: str, body: ModelUpdateRequest, request: Request) -> ModelResponse:
    """Update an existing model and persist changes to config.yaml. Super admin only."""
    await require_min_role(request, "super")
    cfg: AppConfig = get_config(request)

    config_data, config_path = _load_config_yaml()
    existing_models = config_data.get("models", [])

    target_idx = None
    for i, m in enumerate(existing_models):
        if m.get("name") == model_name:
            target_idx = i
            break
    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    target = existing_models[target_idx]
    if body.model is not None:
        target["model"] = body.model
    if body.display_name is not None:
        target["display_name"] = body.display_name
    if body.description is not None:
        target["description"] = body.description
    if body.use is not None:
        target["use"] = body.use
    if body.api_key is not None:
        env_key = f"{model_name.upper()}_API_KEY"
        target["api_key"] = f"${env_key}"
        _write_env_var(env_key, body.api_key)
    if body.base_url is not None:
        target["base_url"] = body.base_url
    if body.supports_vision is not None:
        target["supports_vision"] = body.supports_vision

    try:
        config_data["models"] = existing_models
        _save_config_yaml(config_data, config_path)

        reload_app_config(str(config_path))
        request.app.state.config = get_app_config()
    except Exception as e:
        logger.exception("Failed to update model")
        raise HTTPException(status_code=500, detail=f"Failed to update model: {e!s}")

    return ModelResponse(
        name=target["name"],
        model=target.get("model", ""),
        display_name=target.get("display_name"),
        description=target.get("description"),
        use=target.get("use", "langchain_openai:ChatOpenAI"),
        supports_vision=target.get("supports_vision", False),
    )


@router.delete(
    "/models/{model_name}",
    status_code=204,
    summary="Delete Model",
    description="Remove an AI model from the configuration.",
)
async def delete_model(model_name: str, request: Request) -> None:
    """Delete a model from config.yaml. Super admin only."""
    await require_min_role(request, "super")
    cfg: AppConfig = get_config(request)

    config_data, config_path = _load_config_yaml()
    existing_models = config_data.get("models", [])

    filtered = [m for m in existing_models if m.get("name") != model_name]
    if len(filtered) == len(existing_models):
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    try:
        config_data["models"] = filtered
        _save_config_yaml(config_data, config_path)

        reload_app_config(str(config_path))
        request.app.state.config = get_app_config()
    except Exception as e:
        logger.exception("Failed to delete model")
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {e!s}")


def _write_env_var(key: str, value: str) -> None:
    """Write or update an environment variable in the .env file."""
    env_path = Path(__file__).resolve().parents[4] / ".env"
    if not env_path.exists():
        env_path.write_text(f"{key}={value}\n", encoding="utf-8")
        return

    lines = env_path.read_text(encoding="utf-8").splitlines()
    found = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            found = True
            break
    if not found:
        lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
