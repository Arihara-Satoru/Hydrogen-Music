# Project Workflow Memory

- `origin` is the user's fork: `Arihara-Satoru/Hydrogen-Music`.
- `upstream` is the original author's repository: `ldx123000/Hydrogen-Music`.
- For any project change, first fetch the latest `origin/KuGou`, then create a new working branch from `origin/KuGou`.
- Make edits only on that new branch, commit there, and push the branch to `origin`.
- Do not push directly to `KuGou`; it is protected. Open a pull request in the user's fork with `base=KuGou` and `head=<working-branch>`, then let the user approve and merge it.
- Do not push branches or open pull requests against `upstream` unless the user explicitly asks for that.
