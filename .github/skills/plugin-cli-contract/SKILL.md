---
name: plugin-cli-contract
description: "Design or implement CommBurn CLI, AI-tool, automation, and plugin integrations that share the document model and exact project license."
---

# CLI, AI, and plugin contract

Use this workflow when changing automation surfaces or plugin support.

1. Read the project guide and `docs/PLUGIN_CLI_CONTRACT.md`.
2. Reuse the shared document core; do not fork geometry or unit-conversion behavior in an adapter.
3. Keep machine-dependent actions opt-in and outside the document model unless explicitly requested.
4. Provide deterministic, machine-readable input/output and explicit errors for invalid requests.
5. Keep plugin licensing identical to this repository's MIT license; reject incompatible alternate license terms.
6. Keep UI integration modular through the documented `data-extension-slot` seams; do not execute remote plugin code or bypass core validation.
7. Test the same document through the core and CLI, including malformed input, transforms, and coordinate settings.

## References

- [CLI and plugin contract](../../../docs/PLUGIN_CLI_CONTRACT.md)
- [UI architecture and extension slots](../../../docs/UI_ARCHITECTURE.md)
- [Project guide](../../../docs/PROJECT_GUIDE.md)
