---
name: smart_git_push
description: Automates the git commit and push workflow with intelligent message generation.
---

# Smart Git Push

This skill removes the friction of manual git operations by intelligently generating commit messages and managing the push process.

## Workflow

When the user says "push", "save to git", or "upload code":

1.  **Analyze Changes**:
    -   Run `git status` to see what changed.
    -   Run `git diff --cached` (or `git diff` if not staged) to understand *what* changed.

2.  **Stage Files**:
    -   If the user implies "all", run `git add .`.
    -   Otherwise, confirm specific files.

3.  **Generate Message**:
    -   Create a commit message following the exact format: `[Type] Short Summary`.
    -   **Type Examples**: `feat`, `fix`, `docs`, `style`, `refactor`, `chore`.
    -   **Example**: `feat: Add new StarJar component with animation`

4.  **Execute & Push**:
    -   Run `git commit -m "..."`.
    -   Run `git push`.
    -   Report success.

## Command Shortcut
// If the user says `/push` or "smart push", you can proceed with `git add .` automatically if you are confident.
