# Changelog

All notable changes to `@betanyc/nyc-council-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are npm publish dates (`npm view @betanyc/nyc-council-mcp time`).

## [Unreleased]

Nothing yet — v2.1.0 was published from the current tip of `main`.

## [2.1.0] - 2026-07-01

### Added

- Hearing agenda items populated in `get_upcoming_hearings` (#5).
- CI build & test gate on a Node 20.x/22.x matrix (#6).

### Fixed

- Resolved a high-severity transitive advisory in `hono`.
- Synced `package-lock.json` self-version to `package.json`.

### Documentation

- Clear API-key subsection in the README (#4).
- Documented the `LEGISTAR_LINK_BILLS` env var and token cost note; corrected
  its URL format.

## [2.0.0] - 2026-05-26

### Changed

- **Breaking:** v2 hybrid mode — local SQLite index plus live Legistar API,
  replacing the v1 live-only design.

## [1.0.1] - 2026-05-22

### Added

- npm keywords for discoverability.
- MIT LICENSE file and full license text in the README.

## [1.0.0] - 2026-05-19

### Added

- Initial public release: MCP server for NYC Council legislative data via the
  Legistar API — bills, hearings, votes, committees, and council members.

[Unreleased]: https://github.com/BetaNYC/nyc-council-mcp/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/BetaNYC/nyc-council-mcp/compare/v1.0.0...v2.1.0
[2.0.0]: https://github.com/BetaNYC/nyc-council-mcp/commit/6dc18f7
[1.0.1]: https://github.com/BetaNYC/nyc-council-mcp/commit/c6f4de0
[1.0.0]: https://github.com/BetaNYC/nyc-council-mcp/releases/tag/v1.0.0

<!-- 2.0.0 and 1.0.1 were published before this repo started tagging releases,
so their links point at the version-bump commits rather than tags. -->

