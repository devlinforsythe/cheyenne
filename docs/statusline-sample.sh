#!/bin/bash
# A sample Cheyenne / Claude Code status line: model, git branch, folder.
# Set it in ~/.claude/settings.json or <project>/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/statusline-sample.sh" }
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // .model.id')
dir=$(echo "$input" | jq -r '.workspace.current_dir')
branch=$(git -C "$dir" branch --show-current 2>/dev/null)
printf '\033[1;36m%s\033[0m' "$model"
[ -n "$branch" ] && printf ' on \033[35m%s\033[0m' "$branch"
printf ' in \033[33m%s\033[0m\n' "$(basename "$dir")"
