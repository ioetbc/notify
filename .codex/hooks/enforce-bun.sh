#!/bin/bash
# Intercepts package manager commands and enforces bun

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Check if the command uses npm or yarn for package operations
if echo "$COMMAND" | grep -qE '(^|\s)(npm|yarn|pnpm)\s+(install|i|add|remove|uninstall)'; then
  jq -n '{
    decision: "block",
    reason: "Use bun instead of npm/yarn/pnpm. Replace with: bun install, bun add <package>, or bun remove <package>"
  }'
  exit 0
fi

# Allow all other commands
exit 0
