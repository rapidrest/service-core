=============
Release Notes
=============

v7.0.0
======

- Upgrading to latest `rapidrest-js/core`
- Fix underlying destroy functionality

v6.0.1
======

- Fix merging of OpenApi objects

v6.0.0
======

- Upgrading `mongodb` to 6
- Upgrade to latest `typescript`, 5.x
- Add redis session cache store
- Upgrade dependencies
- Migrate lint to flat config

v5.1.1
======

- Fix OpenAPI.json to return non-stringified JSON
- Allow ignoring of script files for ClassLoader

v5.0.0
======

- Upgraded dependencies
- Updated repo documents
- Removed deprecated RouteDecorator Init
- Updated to allow WebSocket Request to pass query arguments
- Leverage new ApiError class for error reporting

v4.1.0
======

- Upgraded dependencies
- Updated repo documents
- Removed deprecated RouteDecorator Init
- Updated to allow WebSocket Request to pass query arguments
- Leverage new ApiError class for error reporting

v4.0.0
======

- Upgraded dependencies and removed unneeded
- General project cleanup

v3.13.0
======

- Fix support for `@ContentType` decorators
- Hooked in remaining standard metrics, and added support for response time capturing

v3.6.0
======

- Adding automatic authentication handshaking for all @WebSocket endpoints
- Added `/admin/inspect` endpoint for exposing NodeJS inspector for remote debugging
- Fixed issues with `/admin/logs` endpoint
- `SimpleMongoEntity` now uses `ObjectId` class from mongodb driver instead of typeorm copy
- Upgraded `core` dependency
- Various fixes to CI/CD pipeline
- Upgraded to yarn v4
- `ObjectFactor.classes` is now public
- Fixed `X-Powered-By` header output
- Prometheus metrics are no longer defined as static variables

v3.2.0
======

- Moved all database decorators to their own namespace `DatabaseDecorators`
- Fixed export for `addWebSocket` function

v3.1.0
=======

- Removed `ClassLoader` dependency from `BackgroundServiceManager`
- Various bug fixes and improvements to `NetUtils`
- Added default `AdminRoute` for common administrative operations
- Exposing JWT `token` and `profile` data to all incoming requests
- Upgraded dependencies

v2.12.0
=======

- `ModelRoute` now sends push notifications to downstream clients when executing `doCreate`, `doDelete` or `doUpdate`.

v2.11.0
=======

- Integrated RapidREST v1.13.0 including WebSocket support.
- Rolling back TypeORM dependency to v0.2.28 to fix DNS lookup issue introduced with v0.2.29+.
- Fixing issue that caused `EventListenerManager` to register event listeners multiple times.
- Refactored event handler initialization code.
- Event listeners can now register for events using regular expressions.

v2.10.0
=======

- Integrated RapidREST v1.12.0
- Fixed issues with background jobs not being fully initialized before server startup completes.
- Fixed issue with processing route handler classes that caused server to finish startup prematurely.
- Fixing various other issues.

v2.9.0
======

- Integrated RapidREST v1.11.0

v2.8.0
======

- Integrated RapidREST v1.10.1

v2.7.0
======

- Added `safe mode` to scripting system that will disable loading of all scripts stored in the database. This results
  in only scripts on the local file system to be loaded.

v2.6.0
======

- Added ability to disable scripts.

v2.5.0
======

- Integrated RapidREST v1.7.3.
- Deleting scripts no longer remvoes entries from the database, instead marks them as deleted, so that they can be restored.
- Fixing issue that caused publishing scripts to create a new document version.
- Fixing database indexing for Script data model.
- Fixing issue with URL parsing.
- Script compiling now writes temporary files in their proper relative directory structure to preserve imports.

v2.4.0
======

- Scripting system can now accept `Buffer` or string types for script data.
- Scripting system now rejects `POST` and `PUT` operations on scripts that cannot be compiled.
- `ScriptUtils.import` is now an async function that returns a `Promise`.
- Refactored package dependencies.
- Added debug logging to `ObjectFactory`.
- Fixing issues with `ObjectFactory` calling destructor functions

v2.3.0
======

- Specifying a source path as the temporary script path will no longer overwite local files.

v2.2.0
======

- Integrated RapidREST v1.7.0
- `ScriptManager` ignore list can now accept regular expression patterns

v2.1.0
======

- `ObjectFactory.newInstance` no longer requires class types to be pre-registered before instantiation.
- Various bug fixes
- Updated documentation

v2.0.0
======

- Introduced the new Live Scripting system. The Live Scripting system stores all application code into a configured
  `scripts` datastore and automatically retrieves and loads the code from the database at Server startup.
  In addition to being able to store code in the database, a new default REST API endpoint `/scripts` has been added
  to allow for the management of all stored scripts including the ability to define entirely new scripts.
- Added new event listener system. The event listener systems allows any class/function to be registered as an event
  listener. The event listener receives incoming events from the telemetry system on a redis pub/sub channel. These
  events are then processed by custom code automatically.