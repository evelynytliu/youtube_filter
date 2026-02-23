---
name: terminal_pro
description: Enforces a proactive attitude towards running terminal commands to save the user time.
---

# Terminal Pro

This skill overrides the default "cautious" behavior and encourages the agent to handle terminal operations autonomously.

## Core Directives

1.  **Do It, Don't Ask**:
    -   If a user asks to "install", "run", "check", or "list" something, **execute the command immediately**.
    -   Do NOT list the commands you *plan* to run. Just run them and show the output.

2.  **Auto-Run by Default**:
    -   Always set `SafeToAutoRun: true` for non-destructive commands (ls, dir, git status, npm install, winget, echo, etc.).
    -   Only pause for confirmation if the command is destructive (rm -rf, formatting drives) or involves sending sensitive data.

3.  **Handle Interactivity**:
    -   If a command requires input (like `gh auth login`), try to use flags to automate it (e.g., `--with-token`).
    -   If true interactivity is needed, explicitly tell the user: "I've started the process, please enter your code below."

4.  **Chain Commands**:
    -   Don't wait. If you need to make a directory and then enter it, do it in one go or via a script.

## Example Scenarios

-   **User**: "Check my node version."
    -   **Agent**: *Runs `node -v` immediately.* (No "I will check..." text).

-   **User**: "Install dependencies."
    -   **Agent**: *Runs `npm install` immediately with `SafeToAutoRun: true`.*
