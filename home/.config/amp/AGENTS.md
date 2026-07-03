# Personal Amp Preferences

## Jujutsu

Do not commit changes unless I explicitly ask you to commit. Leave completed work uncommitted and report the status instead.

When working on an already pushed bookmark/branch, update the bookmark to the latest committed change before pushing:

```sh
jj tug
jj git push
```

When no bookmark has been created off main and I ask you to push a committed jj change, use:

```sh
jj git push -c @-
```

Prefer `@-` in the no-bookmark case because after `jj commit`, the working copy `@` is an empty successor and the committed change is the parent.

## Pull Requests

When creating a GitHub pull request for me, do not include a PR description/body unless I explicitly ask for one.

## UX

Do not use all-uppercase text in UI copy unless I explicitly ask for it.
