# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.2] - 2026-09-08

### Changed
- Upgraded @rapidrest/core dependency

## [1.7.1] - 2026-09-08

### Fixed
- Fixed issue with new @RateLimit middleware that causes any decorated endpoint to hang indefinitely
- Fixed release notes file

## [1.7.0] - 2026-09-08

### Added
- Added new RateLimiter utility for rate limiting requests
- Added @RateLimit decorator and accompanying middleware for applying rate limiting

### Changed
- Attempting to fix CI publish workflow

### Fixed
- Fixed issue with HTTP adpater that did not URL decode parameterized paths properly

## [1.6.0] - 2026-09-08

### Added
- Added installation of build-essential to CI build job
- Added install of python3 to build CI

### Changed
- - Check updateOne()/repo.update()'s result before falling through to the findOne(version+1) fallback
- - Throw INVALID_OBJECT_VERSION when zero rows matched/affected instead of returning a concurrent writer's row
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Changing how SQL eq(null) queries are built from `Equal(null)` to `IsNull())` which produces desired results
- Upgraded all package deps
- Switched from custom release script to rapidrest CLI
- Changed ACLUtils.getRecord to  allow controllable search depth and specificity

### Fixed
- Fixed RepoUtils.update() silently losing an optimistic-lock conflict
- Fixed issue with `yarn install` on CI
- Fixed more issues with CI jobs

### Removed
- Removed disable of redis build for CI build job


## [1.5.0] - 2026-09-07

### Added
- Added changelog and release script

### Changed
- Letting app-registered OPTIONS routes run instead of the blanket CORS preflight 204

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

[Unreleased]: https://github.com/rapidrest/service-core/compare/v1.7.2...HEAD
[1.7.2]: https://github.com/rapidrest/service-core/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/rapidrest/service-core/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/rapidrest/service-core/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/rapidrest/service-core/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rapidrest/service-core/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/rapidrest/service-core/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/rapidrest/service-core/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rapidrest/service-core/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/rapidrest/service-core/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rapidrest/service-core/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rapidrest/service-core/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rapidrest/service-core/commit/3847e60f663be5100d74f855859819bb74984697
