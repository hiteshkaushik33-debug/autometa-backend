# Push to another GitHub account

The workspace is not initialized as a Git repository yet. Create an EMPTY GitHub repository
under the destination account first. Do not initialize that remote with a README/license.

Run this PowerShell sequence from the autometa root. Git metadata is deliberately placed in
backend/.git so the root keeps only admin, backend and users. The helper affects this shell only.

```powershell
cd 'C:\Users\Pratham Kaushik\Desktop\extra\autometa'
function ag { git --git-dir=backend/.git --work-tree=. @args }
ag init -b main

# Optional: set commit author identity for this repository only.
# ag config user.name 'YOUR_NAME'
# ag config user.email 'YOUR_VERIFIED_GITHUB_EMAIL'

ag add admin backend users
ag status --short
ag diff --cached --stat
ag commit -m 'Prepare Autometa production beta'
ag remote add other 'https://github.com/OTHER_ACCOUNT/REPO.git'
ag -c credential.helper= -c credential.username=OTHER_ACCOUNT push -u other main
```

Replace OTHER_ACCOUNT and REPO. When Git asks for the password, paste that account's personal
access token into the password prompt. It does not belong in the remote URL, the command,
source files, .env or this chat. The command bypasses cached credentials for this push only;
it does not erase or change credentials used by your other projects.

The token needs permission to push to the selected repository (fine-grained Contents read/write,
with the correct repository selected, or an appropriately scoped classic token). Commit author
identity and authentication are separate; changing user.email does not select a login account.

Before committing, review staged filenames. .env files, .local secrets/backups, node_modules,
.next and dist are ignored separately under all three folders. .env.example is a public template
and must contain placeholders only. The nested Git layout and ignore behavior were checked
using dummy files; no real credentials were staged by that check.

If the remote name already exists, use ag remote set-url other with the same clean HTTPS URL.
If the remote already contains commits, inspect/fetch and reconcile that history; no force-push
is needed for the empty-repository flow above.

Git Bash equivalent helper, from the same root:

```bash
ag() { git --git-dir=backend/.git --work-tree=. "$@"; }
```

The remaining ag commands are the same. Keep running the helper from the autometa root.

Official reference: [GitHub HTTPS authentication and remotes](https://docs.github.com/en/get-started/git-basics/about-remote-repositories).
