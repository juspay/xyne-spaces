# SDLC

The SDLC hub: a channel that tracks a set of repositories and keeps generated knowledge and a wiki about them.

## Language

**Hub**:
A channel set up for SDLC, identified by its channel id. Every SDLC workflow belongs to exactly one hub.
_Avoid_: SDLC channel, space

**Hub repository**:
A repository connected to a hub. A wiki run covers the hub repositories chosen in its config.
_Avoid_: repo (alone), project

**Start commit**:
The commit a repository's wiki run begins from, set in the workflow config. It applies once: the first run after it is set starts there, and once that run documents its first window, later runs continue as usual. Setting a different commit applies again. When empty, the run continues from where the last run ended, or from the first commit if there was none.
_Avoid_: override, base commit, since-commit

**Commit window**:
A slice of at most `commitsPerRun` consecutive commits of one repository, processed by one generate and correct pass.
_Avoid_: batch, chunk
