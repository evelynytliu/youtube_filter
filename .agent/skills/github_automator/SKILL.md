---
name: github_automator
description: Automates GitHub repository creation, configuration, and management using GitHub CLI.
---

# GitHub Automator

This skill helps you manage GitHub repositories directly from the conversation.

## Capabilities

### 1. Create Repository
When the user asks to "create a repo" or "init github":

1.  **Check Status**: 
    -   Run `git status` to check if it's already a git repo.
    -   If not, run `git init`.

2.  **Create Remote**:
    -   Use `gh repo create` to create the repo.
    -   Ask the user: "Public or Private?" (Default to Private for safety).
    -   Command: `gh repo create <name> --private --source=. --remote=origin`
        -   `--source=.`: Use current directory.
        -   `--remote=origin`: Automatically add the remote.

3.  **Initial Push**:
    -   `git add .`
    -   `git commit -m "feat: Initial commit"`
    -   `git push -u origin main` (or master)

### 2. Configure Settings
-   **Homepage**: `gh repo edit --homepage "https://..."`
-   **Description**: `gh repo edit --description "..."`

## Troubleshooting
-   If `gh` commands fail with "authentication failed", instruct the user to run `gh auth login` in their terminal once.
