# @chat-agent/memory-system

Memory System package for:

- TurnRecord ingestion
- EpisodeCase extraction (LLM/Ollama)
- PolicyCard build/update (LLM/Ollama)
- PolicyCard retrieval for response guidance
- MemoryReport generation for future orchestrator integration

## Current status

- Package scaffold created
- Public TypeScript interfaces defined
- Service API surface defined
- Postgres persistence and Ollama integration are not implemented yet

## Local development

Installed via root `package.json` using a file dependency:

`"@chat-agent/memory-system": "file:packages/memory-system"`
