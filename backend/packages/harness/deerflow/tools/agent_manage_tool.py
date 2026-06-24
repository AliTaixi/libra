"""Tool for creating and managing custom agents (智能体)."""

from __future__ import annotations

import logging
from pathlib import Path

import yaml
from langchain.tools import tool

from deerflow.config.paths import get_paths
from deerflow.runtime.user_context import get_effective_user_id
from deerflow.tools.sync import make_sync_tool_wrapper
from deerflow.tools.types import Runtime

logger = logging.getLogger(__name__)

AGENT_NAME_PATTERN = "name must match ^[A-Za-z0-9-]+$"


def _validate_agent_name(name: str) -> str:
    """Validate agent name - only letters, digits, and hyphens."""
    import re
    if not re.match(r"^[A-Za-z0-9-]+$", name):
        raise ValueError(f"Invalid agent name '{name}'. {AGENT_NAME_PATTERN}")
    return name.lower()


async def _agent_manage_impl(
    runtime: Runtime,
    action: str,
    name: str,
    description: str = "",
    soul: str = "",
    skills: list[str] | None = None,
) -> str:
    """Manage custom agents under the user's agents directory.

    Creates, edits, or deletes a custom agent. Each agent has:
    - config.yaml (name, description, skills)
    - SOUL.md (personality and behavior instructions)

    Args:
        action: One of create, edit, delete.
        name: Agent name in lowercase-hyphen-case (e.g. "my-agent").
        description: Short description of what the agent does.
        soul: SOUL.md content - defines the agent's personality and behavior.
        skills: List of skill names to enable for this agent (e.g. ["chart-code-generation"]).
    """
    name = _validate_agent_name(name)
    user_id = get_effective_user_id()
    paths = get_paths()
    agent_dir = paths.user_agent_dir(user_id, name)

    if action == "create":
        if agent_dir.exists():
            raise ValueError(f"Agent '{name}' already exists.")
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Write config.yaml
        config_data = {"name": name}
        if description:
            config_data["description"] = description
        if skills:
            config_data["skills"] = skills

        config_file = agent_dir / "config.yaml"
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        # Write SOUL.md
        if soul:
            soul_file = agent_dir / "SOUL.md"
            soul_file.write_text(soul, encoding="utf-8")

        logger.info(f"Created agent '{name}' for user '{user_id}' at {agent_dir}")
        return f"Created agent '{name}' successfully."

    if action == "edit":
        if not agent_dir.exists():
            raise ValueError(f"Agent '{name}' not found.")
        config_file = agent_dir / "config.yaml"
        if config_file.exists():
            with open(config_file, encoding="utf-8") as f:
                config_data = yaml.safe_load(f) or {}
        else:
            config_data = {"name": name}

        if description:
            config_data["description"] = description
        if skills is not None:
            config_data["skills"] = skills

        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        if soul:
            agent_dir / "SOUL.md".write_text(soul, encoding="utf-8")

        logger.info(f"Updated agent '{name}' for user '{user_id}'")
        return f"Updated agent '{name}' successfully."

    if action == "delete":
        if not agent_dir.exists():
            raise ValueError(f"Agent '{name}' not found.")
        import shutil
        shutil.rmtree(agent_dir)
        logger.info(f"Deleted agent '{name}' for user '{user_id}'")
        return f"Deleted agent '{name}' successfully."

    raise ValueError(f"Unsupported action '{action}'. Use create, edit, or delete.")


@tool("agent_manage", parse_docstring=True)
async def agent_manage_tool(
    runtime: Runtime,
    action: str,
    name: str,
    description: str = "",
    soul: str = "",
    skills: list[str] | None = None,
) -> str:
    """Manage custom agents (智能体).

    Create, edit, or delete a custom agent. Each agent has its own config, description,
    skills, and personality (SOUL.md).

    Args:
        action: One of "create", "edit", "delete".
        name: Agent name in lowercase-hyphen-case (e.g. "my-assistant").
        description: Short description of what the agent does (used when creating).
        soul: SOUL.md content - defines the agent's personality and behavior (used when creating/editing).
        skills: List of skill names to enable (e.g. ["chart-code-generation"]). Omit or pass null to use all enabled skills.
    """
    return await _agent_manage_impl(
        runtime=runtime,
        action=action,
        name=name,
        description=description,
        soul=soul,
        skills=skills,
    )


agent_manage_tool.func = make_sync_tool_wrapper(_agent_manage_impl, "agent_manage")
