#!/bin/bash
# enforce-file-structure.sh
# Prompts Claude to follow the project's folder structure conventions when creating files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Only validate Write operations (new file creation)
if [[ "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

# Skip non-TypeScript files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]]; then
  exit 0
fi

# Extract filename and directory
FILENAME=$(basename "$FILE_PATH")
DIR=$(dirname "$FILE_PATH")
DIRNAME=$(basename "$DIR")

# Define the folder structure rules as guidance
STRUCTURE_RULES="
FOLDER STRUCTURE RULES:

Operations (e.g., get-products, add-to-cart) - own folder:
  operation-name/
  ├── index.ts                    # Exports main function
  ├── operation-name.ts           # Main function implementation
  ├── operation-name.helper.ts    # Helper functions (if needed)
  └── operation-name.types.ts     # Local types (if needed)

Shared utilities go in shared/:
  shared/helper-name/
  ├── index.ts
  ├── helper-name.ts
  └── helper-name.*.ts

NAMING:
- Folders and main files: kebab-case
- Helper files: operation-name.helper-name.ts
- Don't repeat words in helper names
- Every folder MUST have an index.ts that exports main function(s)

CURRENT FILE: $FILE_PATH
"

# Check if this is an index.ts file (always allowed)
if [[ "$FILENAME" == "index.ts" || "$FILENAME" == "index.tsx" ]]; then
  exit 0
fi

# Check if filename follows pattern: dirname.ts or dirname.something.ts
EXPECTED_PREFIX="$DIRNAME"

# If the filename starts with the directory name, it's likely following the pattern
if [[ "$FILENAME" == "$EXPECTED_PREFIX.ts" ]] || [[ "$FILENAME" == "$EXPECTED_PREFIX."*.ts ]] || [[ "$FILENAME" == "$EXPECTED_PREFIX.tsx" ]] || [[ "$FILENAME" == "$EXPECTED_PREFIX."*.tsx ]]; then
  exit 0
fi

# File doesn't follow expected pattern - ask for confirmation
jq -n \
  --arg rules "$STRUCTURE_RULES" \
  --arg file "$FILE_PATH" \
  --arg expected "Files should be named: $EXPECTED_PREFIX.ts, $EXPECTED_PREFIX.something.ts, or index.ts" \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: ($rules + "\n\nExpected: " + $expected + "\n\nDoes this file follow the folder structure convention?")
    }
  }'

exit 0
