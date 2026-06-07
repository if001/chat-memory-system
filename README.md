# @chat-agent/memory-system

Memory System package for:

- TurnRecord ingestion
- EpisodeCase extraction (LLM/Ollama)
- PolicyCard build/update (LLM/Ollama)
- PolicyCard retrieval for response guidance
- Memory maintenance report generation
- Relationship insight report generation for future orchestrator integration
- File-cached LLM calls for repeated identical prompts

## Current status

- Package scaffold created
- Public TypeScript interfaces defined
- Service API surface defined
- Postgres persistence and Ollama integration are not implemented yet

## Local development

Installed via root `package.json` using a file dependency:

`"@chat-agent/memory-system": "file:packages/memory-system"`

Key runtime knobs:

- `OLLAMA_API_KEY`
  - optional for local Ollama, required for cloud-backed Ollama
- `MEMORY_LLM_CACHE_DIR`
  - file cache directory for identical LLM prompt pairs
  - default: `data/memory-system/llm-cache` under current working directory
- `MEMORY_LLM_CACHE_TTL_MS`
  - cache TTL in milliseconds
  - default: `86400000` (24 hours)
