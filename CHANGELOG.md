# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-08-27

### Fixed
- Reverted a change that incorrectly restricted legitimate dot-notation queries of MongoDB sub-documents

## [1.3.1] - 2026-08-25

### Added
- Added a contributing guide

### Changed
- Renamed the contributors file to `CONTRIBUTORS.md`

### Fixed
- Fixed an issue where a newly created Redis client was not automatically connected before being injected into a constructed object

## [1.3.0] - 2026-08-22

### Changed
- Upgraded all dependencies
- Reverted the CI build image back to `node:lts-trixie-slim`
- `build.yml` test job now runs `yarn test` instead of invoking `vitest` directly
- Updated `@rapidrest/core`

### Fixed
- Fixed additional GitHub Actions workflow issues

## [1.2.1] - 2026-08-21

### Changed
- Switched the CI build image to `node:lts-bookworm-slim`

### Fixed
- Fixed license section in the README

## [1.2.0] - 2026-08-21

### Changed
- Changed scope of `_objectFactory` declaration from private to protected for `AuthMiddleware`, `SessionManager`, `RepoUtils`, `ModelRoute`, and `ACLUtils`

### Fixed
- Fixed outdated Bun smoke test
- Fixed GitHub CI publish workflow

## [1.1.0] - 2026-08-21

### Changed
- Upgraded all dependencies

## [1.0.0] - 2026-08-21

### Added
- Initial release

[Unreleased]: https://github.com/rapidrest/service-core/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/rapidrest/service-core/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/rapidrest/service-core/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rapidrest/service-core/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/rapidrest/service-core/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rapidrest/service-core/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rapidrest/service-core/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rapidrest/service-core/commit/3847e60f663be5100d74f855859819bb74984697
