# Personal Amp Preferences

## Jujutsu

When I ask you to push a committed jj change, use:

```sh
jj git push -c @-
```

Prefer `@-` because after `jj commit`, the working copy `@` is usually an empty successor and the committed change is the parent.

## Pull Requests

When creating a GitHub pull request for me, do not include a PR description/body unless I explicitly ask for one.
