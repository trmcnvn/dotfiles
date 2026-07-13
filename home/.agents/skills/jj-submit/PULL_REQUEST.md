# Publish and Open the Pull Request

## 1. Validate the outgoing stack

Inspect the complete range from the target base through `@-`. Every outgoing revision must belong to this pull request, have a non-empty description, and contain no unresolved conflicts. Resolve stack ambiguity before publishing.

Run `gh auth status` and identify the GitHub repository and optional requested base branch.

**Complete when:** the exact outgoing stack, tip `@-`, GitHub repository, authentication, and base are confirmed.

## 2. Push the tip

Run exactly:

```bash
jj git push -c @-
```

Capture the generated bookmark from the command output. Verify with `jj bookmark list -r @-` that the pushed bookmark points to the intended tip. If the push fails, stop and report the error and recovery action; no pull request has been created.

**Complete when:** the generated bookmark points to `@-` locally and exists on the selected remote.

## 3. Create or find the pull request

Check for a pull request already associated with the pushed bookmark. Return an existing open pull request instead of creating another. Surface a closed or merged match before attempting replacement.

When creating one, derive a concise title from the overall change. Use an empty body unless the invocation guidance explicitly requests content:

```bash
gh pr create --head '<bookmark>' --title '<title>' --body ''
```

Add `--base '<base>'` only when a base was requested or repository inference is wrong. Capture and verify the resulting URL. If creation fails after the push, report the pushed bookmark, the exact failure, and the next recovery command.

**Complete when:** one open pull request targets the pushed bookmark and its verified URL is known.

## 4. Report

Briefly report commit summaries and verification. Put the pull-request URL alone on the final line.
