# Bar Change Log

Per spec section 2: every bar in the spec holds until Scott changes it in writing.
Changes are logged here, apply forward only, and previously collected rows are
re-evaluated in a single batch pass rather than discarded.

## 2026-09-02 - Bright Data credential provided

Scott supplied a Bright Data API token, addressing part of the credential gap
flagged in run/preflight.json's checklist item 1 and proposed option B. Stored
locally only (run/config/credentials.local.json, gitignored - never committed)
under env_var_name BRIGHT_DATA_API_TOKEN. See run/config/credentials.json for
current status: the token has not yet been verified to authenticate against
Bright Data's API from this session, and no Bright Data MCP tool is connected,
so the original blocking issue in preflight.json (no reliable, cost-bounded
live-fetch path for article body text) is not yet fully resolved. Verifying
the token and deciding how it's used (direct API call vs. MCP connection) is
the next step before Phase One can rely on it.

This run has not left Phase Zero (Preflight).
