# Rewrites every local branch and tag: sets author/committer email and strips Co-authored-by trailers.
# Usage: pwsh scripts/rewrite-authors.ps1 [-Email you@example.com]
param(
    [string]$Email = 'ujjawalkumar1810@gmail.com'
)

$ErrorActionPreference = 'Stop'

if ($Email -notmatch "^[^\s'@]+@[^\s'@]+$") {
    throw "Enter a valid email address."
}

Set-Location (git rev-parse --show-toplevel)

git diff-files --quiet
$dirty = $LASTEXITCODE -ne 0
git diff-index --cached --quiet HEAD
if ($dirty -or $LASTEXITCODE -ne 0) {
    throw "You have uncommitted changes. Commit or stash them, then run this again."
}

$env:FILTER_BRANCH_SQUELCH_WARNING = '1'

git filter-branch -f `
    --env-filter "export GIT_AUTHOR_EMAIL='$Email'; export GIT_COMMITTER_EMAIL='$Email'" `
    --msg-filter "sed '/^co-authored-by:/Id' | git stripspace" `
    --tag-name-filter cat `
    -- --branches --tags

if ($LASTEXITCODE -ne 0) { throw "git filter-branch failed." }

git config user.email $Email

Write-Host "Done. Old refs are backed up under refs/original/."
Write-Host "Check with: git log --format='%h %an <%ae> | %cn <%ce>'"
Write-Host "If 'git status' shows the branch has diverged from origin, publish with: git push --force-with-lease"
