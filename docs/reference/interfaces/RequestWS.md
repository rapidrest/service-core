[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RequestWS

# Interface: RequestWS

HTTP request type for handling WebSockets.

## Hierarchy

- `Request`

    ↳ **`RequestWS`**

## Table of contents

### Properties

- [aborted](RequestWS.md#aborted)
- [accepted](RequestWS.md#accepted)
- [app](RequestWS.md#app)
- [authInfo](RequestWS.md#authinfo)
- [baseUrl](RequestWS.md#baseurl)
- [body](RequestWS.md#body)
- [closed](RequestWS.md#closed)
- [complete](RequestWS.md#complete)
- [connection](RequestWS.md#connection)
- [cookies](RequestWS.md#cookies)
- [destroyed](RequestWS.md#destroyed)
- [errored](RequestWS.md#errored)
- [fresh](RequestWS.md#fresh)
- [headers](RequestWS.md#headers)
- [headersDistinct](RequestWS.md#headersdistinct)
- [host](RequestWS.md#host)
- [hostname](RequestWS.md#hostname)
- [httpVersion](RequestWS.md#httpversion)
- [httpVersionMajor](RequestWS.md#httpversionmajor)
- [httpVersionMinor](RequestWS.md#httpversionminor)
- [ip](RequestWS.md#ip)
- [ips](RequestWS.md#ips)
- [method](RequestWS.md#method)
- [next](RequestWS.md#next)
- [originalUrl](RequestWS.md#originalurl)
- [params](RequestWS.md#params)
- [path](RequestWS.md#path)
- [protocol](RequestWS.md#protocol)
- [query](RequestWS.md#query)
- [rawHeaders](RequestWS.md#rawheaders)
- [rawTrailers](RequestWS.md#rawtrailers)
- [readable](RequestWS.md#readable)
- [readableAborted](RequestWS.md#readableaborted)
- [readableDidRead](RequestWS.md#readabledidread)
- [readableEncoding](RequestWS.md#readableencoding)
- [readableEnded](RequestWS.md#readableended)
- [readableFlowing](RequestWS.md#readableflowing)
- [readableHighWaterMark](RequestWS.md#readablehighwatermark)
- [readableLength](RequestWS.md#readablelength)
- [readableObjectMode](RequestWS.md#readableobjectmode)
- [res](RequestWS.md#res)
- [route](RequestWS.md#route)
- [secret](RequestWS.md#secret)
- [secure](RequestWS.md#secure)
- [session](RequestWS.md#session)
- [sessionID](RequestWS.md#sessionid)
- [sessionStore](RequestWS.md#sessionstore)
- [signedCookies](RequestWS.md#signedcookies)
- [socket](RequestWS.md#socket)
- [stale](RequestWS.md#stale)
- [statusCode](RequestWS.md#statuscode)
- [statusMessage](RequestWS.md#statusmessage)
- [subdomains](RequestWS.md#subdomains)
- [trailers](RequestWS.md#trailers)
- [trailersDistinct](RequestWS.md#trailersdistinct)
- [url](RequestWS.md#url)
- [user](RequestWS.md#user)
- [websocket](RequestWS.md#websocket)
- [wsHandled](RequestWS.md#wshandled)
- [xhr](RequestWS.md#xhr)

### Methods

- [[asyncDispose]](RequestWS.md#[asyncdispose])
- [[asyncIterator]](RequestWS.md#[asynciterator])
- [[captureRejectionSymbol]](RequestWS.md#[capturerejectionsymbol])
- [\_construct](RequestWS.md#_construct)
- [\_destroy](RequestWS.md#_destroy)
- [\_read](RequestWS.md#_read)
- [accepts](RequestWS.md#accepts)
- [acceptsCharsets](RequestWS.md#acceptscharsets)
- [acceptsEncodings](RequestWS.md#acceptsencodings)
- [acceptsLanguages](RequestWS.md#acceptslanguages)
- [addListener](RequestWS.md#addlistener)
- [asIndexedPairs](RequestWS.md#asindexedpairs)
- [compose](RequestWS.md#compose)
- [destroy](RequestWS.md#destroy)
- [drop](RequestWS.md#drop)
- [emit](RequestWS.md#emit)
- [eventNames](RequestWS.md#eventnames)
- [every](RequestWS.md#every)
- [filter](RequestWS.md#filter)
- [find](RequestWS.md#find)
- [flatMap](RequestWS.md#flatmap)
- [forEach](RequestWS.md#foreach)
- [get](RequestWS.md#get)
- [getMaxListeners](RequestWS.md#getmaxlisteners)
- [header](RequestWS.md#header)
- [is](RequestWS.md#is)
- [isAuthenticated](RequestWS.md#isauthenticated)
- [isPaused](RequestWS.md#ispaused)
- [isUnauthenticated](RequestWS.md#isunauthenticated)
- [iterator](RequestWS.md#iterator)
- [listenerCount](RequestWS.md#listenercount)
- [listeners](RequestWS.md#listeners)
- [logIn](RequestWS.md#login)
- [logOut](RequestWS.md#logout)
- [login](RequestWS.md#login-1)
- [logout](RequestWS.md#logout-1)
- [map](RequestWS.md#map)
- [off](RequestWS.md#off)
- [on](RequestWS.md#on)
- [once](RequestWS.md#once)
- [param](RequestWS.md#param)
- [pause](RequestWS.md#pause)
- [pipe](RequestWS.md#pipe)
- [prependListener](RequestWS.md#prependlistener)
- [prependOnceListener](RequestWS.md#prependoncelistener)
- [push](RequestWS.md#push)
- [range](RequestWS.md#range)
- [rawListeners](RequestWS.md#rawlisteners)
- [read](RequestWS.md#read)
- [reduce](RequestWS.md#reduce)
- [removeAllListeners](RequestWS.md#removealllisteners)
- [removeListener](RequestWS.md#removelistener)
- [resume](RequestWS.md#resume)
- [setEncoding](RequestWS.md#setencoding)
- [setMaxListeners](RequestWS.md#setmaxlisteners)
- [setTimeout](RequestWS.md#settimeout)
- [some](RequestWS.md#some)
- [take](RequestWS.md#take)
- [toArray](RequestWS.md#toarray)
- [unpipe](RequestWS.md#unpipe)
- [unshift](RequestWS.md#unshift)
- [wrap](RequestWS.md#wrap)

## Properties

### aborted

• **aborted**: `boolean`

The `message.aborted` property will be `true` if the request has
been aborted.

**`Since`**

v10.1.0

**`Deprecated`**

Since v17.0.0,v16.12.0 - Check `message.destroyed` from <a href="stream.html#class-streamreadable" class="type">stream.Readable</a>.

#### Inherited from

Request.aborted

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1144

---

### accepted

• **accepted**: `MediaType`[]

Return an array of Accepted media types
ordered from highest quality to lowest.

#### Inherited from

Request.accepted

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:515

---

### app

• **app**: `Application`\<`Record`\<`string`, `any`\>\>

#### Inherited from

Request.app

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:661

---

### authInfo

• `Optional` **authInfo**: `AuthInfo`

#### Inherited from

Request.authInfo

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:11

---

### baseUrl

• **baseUrl**: `string`

#### Inherited from

Request.baseUrl

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:659

---

### body

• **body**: `any`

#### Inherited from

Request.body

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:640

---

### closed

• `Readonly` **closed**: `boolean`

Is `true` after `'close'` has been emitted.

**`Since`**

v18.0.0

#### Inherited from

Request.closed

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:119

---

### complete

• **complete**: `boolean`

The `message.complete` property will be `true` if a complete HTTP message has
been received and successfully parsed.

This property is particularly useful as a means of determining if a client or
server fully transmitted a message before a connection was terminated:

```js
const req = http.request(
    {
        host: "127.0.0.1",
        port: 8080,
        method: "POST",
    },
    (res) => {
        res.resume();
        res.on("end", () => {
            if (!res.complete) console.error("The connection was terminated while the message was still being sent");
        });
    },
);
```

**`Since`**

v0.3.0

#### Inherited from

Request.complete

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1179

---

### connection

• **connection**: `Socket`

Alias for `message.socket`.

**`Since`**

v0.1.90

**`Deprecated`**

Since v16.0.0 - Use `socket`.

#### Inherited from

Request.connection

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1185

---

### cookies

• **cookies**: `Record`\<`string`, `any`\>

Parsed cookies that have not been signed

#### Inherited from

Request.cookies

#### Defined in

composer-service-core/node_modules/@types/cookie-parser/index.d.ts:13

---

### destroyed

• **destroyed**: `boolean`

Is `true` after `readable.destroy()` has been called.

**`Since`**

v8.0.0

#### Inherited from

Request.destroyed

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:114

---

### errored

• `Readonly` **errored**: `null` \| `Error`

Returns error if the stream has been destroyed with an error.

**`Since`**

v18.0.0

#### Inherited from

Request.errored

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:124

---

### fresh

• **fresh**: `boolean`

Check if the request is fresh, aka
Last-Modified and/or the ETag
still match.

#### Inherited from

Request.fresh

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:625

---

### headers

• **headers**: `IncomingHttpHeaders`

The request/response headers object.

Key-value pairs of header names and values. Header names are lower-cased.

```js
// Prints something like:
//
// { 'user-agent': 'curl/7.22.0',
//   host: '127.0.0.1:8000',
//   accept: '*' }
console.log(request.headers);
```

Duplicates in raw headers are handled in the following ways, depending on the
header name:

- Duplicates of `age`, `authorization`, `content-length`, `content-type`,`etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`,`last-modified`, `location`,
  `max-forwards`, `proxy-authorization`, `referer`,`retry-after`, `server`, or `user-agent` are discarded.
  To allow duplicate values of the headers listed above to be joined,
  use the option `joinDuplicateHeaders` in request and createServer. See RFC 9110 Section 5.3 for more
  information.
- `set-cookie` is always an array. Duplicates are added to the array.
- For duplicate `cookie` headers, the values are joined together with `; `.
- For all other headers, the values are joined together with `, `.

**`Since`**

v0.1.5

#### Inherited from

Request.headers

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1225

---

### headersDistinct

• **headersDistinct**: `Dict`\<`string`[]\>

Similar to `message.headers`, but there is no join logic and the values are
always arrays of strings, even for headers received just once.

```js
// Prints something like:
//
// { 'user-agent': ['curl/7.22.0'],
//   host: ['127.0.0.1:8000'],
//   accept: ['*'] }
console.log(request.headersDistinct);
```

**`Since`**

v18.3.0, v16.17.0

#### Inherited from

Request.headersDistinct

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1240

---

### host

• **host**: `string`

**`Deprecated`**

Use hostname instead.

#### Inherited from

Request.host

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:618

---

### hostname

• **hostname**: `string`

Parse the "Host" header field hostname.

#### Inherited from

Request.hostname

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:613

---

### httpVersion

• **httpVersion**: `string`

In case of server request, the HTTP version sent by the client. In the case of
client response, the HTTP version of the connected-to server.
Probably either `'1.1'` or `'1.0'`.

Also `message.httpVersionMajor` is the first integer and`message.httpVersionMinor` is the second.

**`Since`**

v0.1.1

#### Inherited from

Request.httpVersion

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1153

---

### httpVersionMajor

• **httpVersionMajor**: `number`

#### Inherited from

Request.httpVersionMajor

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1154

---

### httpVersionMinor

• **httpVersionMinor**: `number`

#### Inherited from

Request.httpVersionMinor

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1155

---

### ip

• **ip**: `undefined` \| `string`

Return the remote address, or when
"trust proxy" is `true` return
the upstream addr.

Value may be undefined if the `req.socket` is destroyed
(for example, if the client disconnected).

#### Inherited from

Request.ip

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:580

---

### ips

• **ips**: `string`[]

When "trust proxy" is `true`, parse
the "X-Forwarded-For" ip address list.

For example if the value were "client, proxy1, proxy2"
you would receive the array `["client", "proxy1", "proxy2"]`
where "proxy2" is the furthest down-stream.

#### Inherited from

Request.ips

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:590

---

### method

• **method**: `string`

#### Inherited from

Request.method

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:645

---

### next

• `Optional` **next**: `NextFunction`

#### Inherited from

Request.next

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:668

---

### originalUrl

• **originalUrl**: `string`

#### Inherited from

Request.originalUrl

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:655

---

### params

• **params**: `ParamsDictionary`

#### Inherited from

Request.params

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:647

---

### path

• **path**: `string`

Short-hand for `url.parse(req.url).pathname`.

#### Inherited from

Request.path

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:608

---

### protocol

• **protocol**: `string`

Return the protocol string "http" or "https"
when requested with TLS. When the "trust proxy"
setting is enabled the "X-Forwarded-Proto" header
field will be trusted. If you're running behind
a reverse proxy that supplies https for you this
may be enabled.

#### Inherited from

Request.protocol

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:563

---

### query

• **query**: `ParsedQs`

#### Inherited from

Request.query

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:649

---

### rawHeaders

• **rawHeaders**: `string`[]

The raw request/response headers list exactly as they were received.

The keys and values are in the same list. It is _not_ a
list of tuples. So, the even-numbered offsets are key values, and the
odd-numbered offsets are the associated values.

Header names are not lowercased, and duplicates are not merged.

```js
// Prints something like:
//
// [ 'user-agent',
//   'this is invalid because there can be only one',
//   'User-Agent',
//   'curl/7.22.0',
//   'Host',
//   '127.0.0.1:8000',
//   'ACCEPT',
//   '*' ]
console.log(request.rawHeaders);
```

**`Since`**

v0.11.6

#### Inherited from

Request.rawHeaders

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1265

---

### rawTrailers

• **rawTrailers**: `string`[]

The raw request/response trailer keys and values exactly as they were
received. Only populated at the `'end'` event.

**`Since`**

v0.11.6

#### Inherited from

Request.rawTrailers

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1283

---

### readable

• **readable**: `boolean`

Is `true` if it is safe to call `readable.read()`, which means
the stream has not been destroyed or emitted `'error'` or `'end'`.

**`Since`**

v11.4.0

#### Inherited from

Request.readable

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:70

---

### readableAborted

• `Readonly` **readableAborted**: `boolean`

Returns whether the stream was destroyed or errored before emitting `'end'`.

**`Since`**

v16.8.0

#### Inherited from

Request.readableAborted

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:64

---

### readableDidRead

• `Readonly` **readableDidRead**: `boolean`

Returns whether `'data'` has been emitted.

**`Since`**

v16.7.0, v14.18.0

#### Inherited from

Request.readableDidRead

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:76

---

### readableEncoding

• `Readonly` **readableEncoding**: `null` \| `BufferEncoding`

Getter for the property `encoding` of a given `Readable` stream. The `encoding`property can be set using the `readable.setEncoding()` method.

**`Since`**

v12.7.0

#### Inherited from

Request.readableEncoding

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:81

---

### readableEnded

• `Readonly` **readableEnded**: `boolean`

Becomes `true` when `'end'` event is emitted.

**`Since`**

v12.9.0

#### Inherited from

Request.readableEnded

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:86

---

### readableFlowing

• `Readonly` **readableFlowing**: `null` \| `boolean`

This property reflects the current state of a `Readable` stream as described
in the `Three states` section.

**`Since`**

v9.4.0

#### Inherited from

Request.readableFlowing

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:92

---

### readableHighWaterMark

• `Readonly` **readableHighWaterMark**: `number`

Returns the value of `highWaterMark` passed when creating this `Readable`.

**`Since`**

v9.3.0

#### Inherited from

Request.readableHighWaterMark

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:97

---

### readableLength

• `Readonly` **readableLength**: `number`

This property contains the number of bytes (or objects) in the queue
ready to be read. The value provides introspection data regarding
the status of the `highWaterMark`.

**`Since`**

v9.4.0

#### Inherited from

Request.readableLength

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:104

---

### readableObjectMode

• `Readonly` **readableObjectMode**: `boolean`

Getter for the property `objectMode` of a given `Readable` stream.

**`Since`**

v12.3.0

#### Inherited from

Request.readableObjectMode

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:109

---

### res

• `Optional` **res**: `Response`\<`any`, `Record`\<`string`, `any`\>, `number`\>

After middleware.init executed, Request will contain res and next properties
See: express/lib/middleware/init.js

#### Inherited from

Request.res

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:667

---

### route

• **route**: `any`

#### Inherited from

Request.route

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:651

---

### secret

• `Optional` **secret**: `string`

This request's secret.
Optionally set by cookie-parser if secret(s) are provided. Can be used by other middleware.
[Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) can be used to add your own properties.

#### Inherited from

Request.secret

#### Defined in

composer-service-core/node_modules/@types/cookie-parser/index.d.ts:11

---

### secure

• **secure**: `boolean`

Short-hand for:

req.protocol == 'https'

#### Inherited from

Request.secure

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:570

---

### session

• **session**: `Session` & `Partial`\<`SessionData`\>

This request's `Session` object.
Even though this property isn't marked as optional, it won't exist until you use the `express-session` middleware
[Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) can be used to add your own properties.

**`See`**

SessionData

#### Inherited from

Request.session

#### Defined in

composer-service-core/node_modules/@types/express-session/index.d.ts:17

---

### sessionID

• **sessionID**: `string`

This request's session ID.
Even though this property isn't marked as optional, it won't exist until you use the `express-session` middleware

#### Inherited from

Request.sessionID

#### Defined in

composer-service-core/node_modules/@types/express-session/index.d.ts:23

---

### sessionStore

• **sessionStore**: `SessionStore`

The Store in use.
Even though this property isn't marked as optional, it won't exist until you use the `express-session` middleware
The function `generate` is added by express-session

#### Inherited from

Request.sessionStore

#### Defined in

composer-service-core/node_modules/@types/express-session/index.d.ts:30

---

### signedCookies

• **signedCookies**: `Record`\<`string`, `any`\>

Parsed cookies that have been signed

#### Inherited from

Request.signedCookies

#### Defined in

composer-service-core/node_modules/@types/cookie-parser/index.d.ts:15

---

### socket

• **socket**: `Socket`

The `net.Socket` object associated with the connection.

With HTTPS support, use `request.socket.getPeerCertificate()` to obtain the
client's authentication details.

This property is guaranteed to be an instance of the `net.Socket` class,
a subclass of `stream.Duplex`, unless the user specified a socket
type other than `net.Socket` or internally nulled.

**`Since`**

v0.3.0

#### Inherited from

Request.socket

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1197

---

### stale

• **stale**: `boolean`

Check if the request is stale, aka
"Last-Modified" and / or the "ETag" for the
resource has changed.

#### Inherited from

Request.stale

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:632

---

### statusCode

• `Optional` **statusCode**: `number`

**Only valid for response obtained from ClientRequest.**

The 3-digit HTTP response status code. E.G. `404`.

**`Since`**

v0.1.1

#### Inherited from

Request.statusCode

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1342

---

### statusMessage

• `Optional` **statusMessage**: `string`

**Only valid for response obtained from ClientRequest.**

The HTTP response status message (reason phrase). E.G. `OK` or `Internal Server Error`.

**`Since`**

v0.11.10

#### Inherited from

Request.statusMessage

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1349

---

### subdomains

• **subdomains**: `string`[]

Return subdomains as an array.

Subdomains are the dot-separated parts of the host before the main domain of
the app. By default, the domain of the app is assumed to be the last two
parts of the host. This can be changed by setting "subdomain offset".

For example, if the domain is "tobi.ferrets.example.com":
If "subdomain offset" is not set, req.subdomains is `["ferrets", "tobi"]`.
If "subdomain offset" is 3, req.subdomains is `["tobi"]`.

#### Inherited from

Request.subdomains

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:603

---

### trailers

• **trailers**: `Dict`\<`string`\>

The request/response trailers object. Only populated at the `'end'` event.

**`Since`**

v0.3.0

#### Inherited from

Request.trailers

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1270

---

### trailersDistinct

• **trailersDistinct**: `Dict`\<`string`[]\>

Similar to `message.trailers`, but there is no join logic and the values are
always arrays of strings, even for headers received just once.
Only populated at the `'end'` event.

**`Since`**

v18.3.0, v16.17.0

#### Inherited from

Request.trailersDistinct

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1277

---

### url

• **url**: `string`

#### Inherited from

Request.url

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:657

---

### user

• `Optional` **user**: `User`

#### Inherited from

Request.user

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:12

---

### websocket

• **websocket**: `undefined` \| `WebSocket`

The associated WebSocket connection with this request.

#### Defined in

composer-service-core/src/express/WebSocket.ts:15

---

### wsHandled

• **wsHandled**: `boolean`

Indicates if the request is a websocket request that has been handled.

#### Defined in

composer-service-core/src/express/WebSocket.ts:20

---

### xhr

• **xhr**: `boolean`

Check if the request was an _XMLHttpRequest_.

#### Inherited from

Request.xhr

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:637

## Methods

### [asyncDispose]

▸ **[asyncDispose]**(): `Promise`\<`void`\>

Calls `readable.destroy()` with an `AbortError` and returns a promise that fulfills when the stream is finished.

#### Returns

`Promise`\<`void`\>

**`Since`**

v20.4.0

#### Inherited from

Request.[asyncDispose]

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:651

---

### [asyncIterator]

▸ **[asyncIterator]**(): `AsyncIterableIterator`\<`any`\>

#### Returns

`AsyncIterableIterator`\<`any`\>

#### Inherited from

Request.[asyncIterator]

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:646

---

### [captureRejectionSymbol]

▸ **[captureRejectionSymbol]**\<`K`\>(`error`, `event`, `...args`): `void`

#### Type parameters

| Name |
| :--- |
| `K`  |

#### Parameters

| Name      | Type                 |
| :-------- | :------------------- |
| `error`   | `Error`              |
| `event`   | `string` \| `symbol` |
| `...args` | `AnyRest`            |

#### Returns

`void`

#### Inherited from

Request.[captureRejectionSymbol]

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:125

---

### \_construct

▸ **\_construct**(`callback`): `void`

#### Parameters

| Name       | Type                                    |
| :--------- | :-------------------------------------- |
| `callback` | (`error?`: `null` \| `Error`) => `void` |

#### Returns

`void`

#### Inherited from

Request.\_construct

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:126

---

### \_destroy

▸ **\_destroy**(`error`, `callback`): `void`

#### Parameters

| Name       | Type                                    |
| :--------- | :-------------------------------------- |
| `error`    | `null` \| `Error`                       |
| `callback` | (`error?`: `null` \| `Error`) => `void` |

#### Returns

`void`

#### Inherited from

Request.\_destroy

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:566

---

### \_read

▸ **\_read**(`size`): `void`

#### Parameters

| Name   | Type     |
| :----- | :------- |
| `size` | `number` |

#### Returns

`void`

#### Inherited from

Request.\_read

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:127

---

### accepts

▸ **accepts**(): `string`[]

Check if the given `type(s)` is acceptable, returning
the best match when true, otherwise `undefined`, in which
case you should respond with 406 "Not Acceptable".

The `type` value may be a single mime type string
such as "application/json", the extension name
such as "json", a comma-delimted list such as "json, html, text/plain",
or an array `["json", "html", "text/plain"]`. When a list
or array is given the _best_ match, if any is returned.

Examples:

    // Accept: text/html
    req.accepts('html');
    // => "html"

    // Accept: text/*, application/json
    req.accepts('html');
    // => "html"
    req.accepts('text/html');
    // => "text/html"
    req.accepts('json, text');
    // => "json"
    req.accepts('application/json');
    // => "application/json"

    // Accept: text/*, application/json
    req.accepts('image/png');
    req.accepts('png');
    // => false

    // Accept: text/*;q=.5, application/json
    req.accepts(['html', 'json']);
    req.accepts('html, json');
    // => "json"

#### Returns

`string`[]

#### Inherited from

Request.accepts

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:456

▸ **accepts**(`type`): `string` \| `false`

#### Parameters

| Name   | Type     |
| :----- | :------- |
| `type` | `string` |

#### Returns

`string` \| `false`

#### Inherited from

Request.accepts

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:457

▸ **accepts**(`type`): `string` \| `false`

#### Parameters

| Name   | Type       |
| :----- | :--------- |
| `type` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.accepts

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:458

▸ **accepts**(`...type`): `string` \| `false`

#### Parameters

| Name      | Type       |
| :-------- | :--------- |
| `...type` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.accepts

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:459

---

### acceptsCharsets

▸ **acceptsCharsets**(): `string`[]

Returns the first accepted charset of the specified character sets,
based on the request's Accept-Charset HTTP header field.
If none of the specified charsets is accepted, returns false.

For more information, or if you have issues or concerns, see accepts.

#### Returns

`string`[]

#### Inherited from

Request.acceptsCharsets

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:468

▸ **acceptsCharsets**(`charset`): `string` \| `false`

#### Parameters

| Name      | Type     |
| :-------- | :------- |
| `charset` | `string` |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsCharsets

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:469

▸ **acceptsCharsets**(`charset`): `string` \| `false`

#### Parameters

| Name      | Type       |
| :-------- | :--------- |
| `charset` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsCharsets

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:470

▸ **acceptsCharsets**(`...charset`): `string` \| `false`

#### Parameters

| Name         | Type       |
| :----------- | :--------- |
| `...charset` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsCharsets

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:471

---

### acceptsEncodings

▸ **acceptsEncodings**(): `string`[]

Returns the first accepted encoding of the specified encodings,
based on the request's Accept-Encoding HTTP header field.
If none of the specified encodings is accepted, returns false.

For more information, or if you have issues or concerns, see accepts.

#### Returns

`string`[]

#### Inherited from

Request.acceptsEncodings

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:480

▸ **acceptsEncodings**(`encoding`): `string` \| `false`

#### Parameters

| Name       | Type     |
| :--------- | :------- |
| `encoding` | `string` |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsEncodings

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:481

▸ **acceptsEncodings**(`encoding`): `string` \| `false`

#### Parameters

| Name       | Type       |
| :--------- | :--------- |
| `encoding` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsEncodings

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:482

▸ **acceptsEncodings**(`...encoding`): `string` \| `false`

#### Parameters

| Name          | Type       |
| :------------ | :--------- |
| `...encoding` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsEncodings

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:483

---

### acceptsLanguages

▸ **acceptsLanguages**(): `string`[]

Returns the first accepted language of the specified languages,
based on the request's Accept-Language HTTP header field.
If none of the specified languages is accepted, returns false.

For more information, or if you have issues or concerns, see accepts.

#### Returns

`string`[]

#### Inherited from

Request.acceptsLanguages

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:492

▸ **acceptsLanguages**(`lang`): `string` \| `false`

#### Parameters

| Name   | Type     |
| :----- | :------- |
| `lang` | `string` |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsLanguages

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:493

▸ **acceptsLanguages**(`lang`): `string` \| `false`

#### Parameters

| Name   | Type       |
| :----- | :--------- |
| `lang` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsLanguages

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:494

▸ **acceptsLanguages**(`...lang`): `string` \| `false`

#### Parameters

| Name      | Type       |
| :-------- | :--------- |
| `...lang` | `string`[] |

#### Returns

`string` \| `false`

#### Inherited from

Request.acceptsLanguages

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:495

---

### addListener

▸ **addListener**(`event`, `listener`): `this`

Event emitter
The defined events on documents including:

1. close
2. data
3. end
4. error
5. pause
6. readable
7. resume

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:590

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:591

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:592

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:593

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:594

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:595

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:596

▸ **addListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.addListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:597

---

### asIndexedPairs

▸ **asIndexedPairs**(`options?`): `Readable`

This method returns a new stream with chunks of the underlying stream paired with a counter
in the form `[index, chunk]`. The first index value is `0` and it increases by 1 for each chunk produced.

#### Parameters

| Name       | Type                                 |
| :--------- | :----------------------------------- |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\> |

#### Returns

`Readable`

a stream of indexed pairs.

**`Since`**

v17.5.0

#### Inherited from

Request.asIndexedPairs

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:541

---

### compose

▸ **compose**\<`T`\>(`stream`, `options?`): `T`

#### Type parameters

| Name | Type                            |
| :--- | :------------------------------ |
| `T`  | extends `ReadableStream`\<`T`\> |

#### Parameters

| Name             | Type                                                                   |
| :--------------- | :--------------------------------------------------------------------- |
| `stream`         | `ComposeFnParam` \| `T` \| `Iterable`\<`T`\> \| `AsyncIterable`\<`T`\> |
| `options?`       | `Object`                                                               |
| `options.signal` | `AbortSignal`                                                          |

#### Returns

`T`

#### Inherited from

Request.compose

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:35

---

### destroy

▸ **destroy**(`error?`): `this`

Calls `destroy()` on the socket that received the `IncomingMessage`. If `error`is provided, an `'error'` event is emitted on the socket and `error` is passed
as an argument to any listeners on the event.

#### Parameters

| Name     | Type    |
| :------- | :------ |
| `error?` | `Error` |

#### Returns

`this`

**`Since`**

v0.3.0

#### Inherited from

Request.destroy

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1355

---

### drop

▸ **drop**(`limit`, `options?`): `Readable`

This method returns a new stream with the first _limit_ chunks dropped from the start.

#### Parameters

| Name       | Type                                 | Description                                     |
| :--------- | :----------------------------------- | :---------------------------------------------- |
| `limit`    | `number`                             | the number of chunks to drop from the readable. |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\> | -                                               |

#### Returns

`Readable`

a stream with _limit_ chunks dropped from the start.

**`Since`**

v17.5.0

#### Inherited from

Request.drop

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:527

---

### emit

▸ **emit**(`event`): `boolean`

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `event` | `"close"` |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:598

▸ **emit**(`event`, `chunk`): `boolean`

#### Parameters

| Name    | Type     |
| :------ | :------- |
| `event` | `"data"` |
| `chunk` | `any`    |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:599

▸ **emit**(`event`): `boolean`

#### Parameters

| Name    | Type    |
| :------ | :------ |
| `event` | `"end"` |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:600

▸ **emit**(`event`, `err`): `boolean`

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `event` | `"error"` |
| `err`   | `Error`   |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:601

▸ **emit**(`event`): `boolean`

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `event` | `"pause"` |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:602

▸ **emit**(`event`): `boolean`

#### Parameters

| Name    | Type         |
| :------ | :----------- |
| `event` | `"readable"` |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:603

▸ **emit**(`event`): `boolean`

#### Parameters

| Name    | Type       |
| :------ | :--------- |
| `event` | `"resume"` |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:604

▸ **emit**(`event`, `...args`): `boolean`

#### Parameters

| Name      | Type                 |
| :-------- | :------------------- |
| `event`   | `string` \| `symbol` |
| `...args` | `any`[]              |

#### Returns

`boolean`

#### Inherited from

Request.emit

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:605

---

### eventNames

▸ **eventNames**(): (`string` \| `symbol`)[]

Returns an array listing the events for which the emitter has registered
listeners. The values in the array are strings or `Symbol`s.

```js
import { EventEmitter } from "node:events";

const myEE = new EventEmitter();
myEE.on("foo", () => {});
myEE.on("bar", () => {});

const sym = Symbol("symbol");
myEE.on(sym, () => {});

console.log(myEE.eventNames());
// Prints: [ 'foo', 'bar', Symbol(symbol) ]
```

#### Returns

(`string` \| `symbol`)[]

**`Since`**

v6.0.0

#### Inherited from

Request.eventNames

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:883

---

### every

▸ **every**(`fn`, `options?`): `Promise`\<`boolean`\>

This method is similar to `Array.prototype.every` and calls _fn_ on each chunk in the stream
to check if all awaited return values are truthy value for _fn_. Once an _fn_ call on a chunk
`await`ed return value is falsy, the stream is destroyed and the promise is fulfilled with `false`.
If all of the _fn_ calls on the chunks return a truthy value, the promise is fulfilled with `true`.

#### Parameters

| Name       | Type                                                                                                     | Description                                                   |
| :--------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `boolean` \| `Promise`\<`boolean`\> | a function to call on each chunk of the stream. Async or not. |
| `options?` | `ArrayOptions`                                                                                           | -                                                             |

#### Returns

`Promise`\<`boolean`\>

a promise evaluating to `true` if _fn_ returned a truthy value for every one of the chunks.

**`Since`**

v17.5.0

#### Inherited from

Request.every

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:506

---

### filter

▸ **filter**(`fn`, `options?`): `Readable`

This method allows filtering the stream. For each chunk in the stream the _fn_ function will be called
and if it returns a truthy value, the chunk will be passed to the result stream.
If the _fn_ function returns a promise - that promise will be `await`ed.

#### Parameters

| Name       | Type                                                                                                     | Description                                                |
| :--------- | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `boolean` \| `Promise`\<`boolean`\> | a function to filter chunks from the stream. Async or not. |
| `options?` | `ArrayOptions`                                                                                           | -                                                          |

#### Returns

`Readable`

a stream filtered with the predicate _fn_.

**`Since`**

v17.4.0, v16.14.0

#### Inherited from

Request.filter

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:434

---

### find

▸ **find**\<`T`\>(`fn`, `options?`): `Promise`\<`undefined` \| `T`\>

This method is similar to `Array.prototype.find` and calls _fn_ on each chunk in the stream
to find a chunk with a truthy value for _fn_. Once an _fn_ call's awaited return value is truthy,
the stream is destroyed and the promise is fulfilled with value for which _fn_ returned a truthy value.
If all of the _fn_ calls on the chunks return a falsy value, the promise is fulfilled with `undefined`.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Parameters

| Name       | Type                                                                           | Description                                                   |
| :--------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => data is T | a function to call on each chunk of the stream. Async or not. |
| `options?` | `ArrayOptions`                                                                 | -                                                             |

#### Returns

`Promise`\<`undefined` \| `T`\>

a promise evaluating to the first chunk for which _fn_ evaluated with a truthy value,
or `undefined` if no element was found.

**`Since`**

v17.5.0

#### Inherited from

Request.find

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:489

▸ **find**(`fn`, `options?`): `Promise`\<`any`\>

#### Parameters

| Name       | Type                                                                                                     |
| :--------- | :------------------------------------------------------------------------------------------------------- |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `boolean` \| `Promise`\<`boolean`\> |
| `options?` | `ArrayOptions`                                                                                           |

#### Returns

`Promise`\<`any`\>

#### Inherited from

Request.find

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:493

---

### flatMap

▸ **flatMap**(`fn`, `options?`): `Readable`

This method returns a new stream by applying the given callback to each chunk of the stream
and then flattening the result.

It is possible to return a stream or another iterable or async iterable from _fn_ and the result streams
will be merged (flattened) into the returned stream.

#### Parameters

| Name       | Type                                                                       | Description                                                                                   |
| :--------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `any` | a function to map over every chunk in the stream. May be async. May be a stream or generator. |
| `options?` | `ArrayOptions`                                                             | -                                                                                             |

#### Returns

`Readable`

a stream flat-mapped with the function _fn_.

**`Since`**

v17.5.0

#### Inherited from

Request.flatMap

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:520

---

### forEach

▸ **forEach**(`fn`, `options?`): `Promise`\<`void`\>

This method allows iterating a stream. For each chunk in the stream the _fn_ function will be called.
If the _fn_ function returns a promise - that promise will be `await`ed.

This method is different from `for await...of` loops in that it can optionally process chunks concurrently.
In addition, a `forEach` iteration can only be stopped by having passed a `signal` option
and aborting the related AbortController while `for await...of` can be stopped with `break` or `return`.
In either case the stream will be destroyed.

This method is different from listening to the `'data'` event in that it uses the `readable` event
in the underlying machinary and can limit the number of concurrent _fn_ calls.

#### Parameters

| Name       | Type                                                                                               | Description                                                   |
| :--------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `void` \| `Promise`\<`void`\> | a function to call on each chunk of the stream. Async or not. |
| `options?` | `ArrayOptions`                                                                                     | -                                                             |

#### Returns

`Promise`\<`void`\>

a promise for when the stream has finished.

**`Since`**

v17.5.0

#### Inherited from

Request.forEach

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:453

---

### get

▸ **get**(`name`): `undefined` \| `string`[]

Return request header.

The `Referrer` header field is special-cased,
both `Referrer` and `Referer` are interchangeable.

Examples:

    req.get('Content-Type');
    // => "text/plain"

    req.get('content-type');
    // => "text/plain"

    req.get('Something');
    // => undefined

Aliased as `req.header()`.

#### Parameters

| Name   | Type           |
| :----- | :------------- |
| `name` | `"set-cookie"` |

#### Returns

`undefined` \| `string`[]

#### Inherited from

Request.get

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:413

▸ **get**(`name`): `undefined` \| `string`

#### Parameters

| Name   | Type     |
| :----- | :------- |
| `name` | `string` |

#### Returns

`undefined` \| `string`

#### Inherited from

Request.get

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:414

---

### getMaxListeners

▸ **getMaxListeners**(): `number`

Returns the current max listener value for the `EventEmitter` which is either
set by `emitter.setMaxListeners(n)` or defaults to defaultMaxListeners.

#### Returns

`number`

**`Since`**

v1.0.0

#### Inherited from

Request.getMaxListeners

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:735

---

### header

▸ **header**(`name`): `undefined` \| `string`[]

#### Parameters

| Name   | Type           |
| :----- | :------------- |
| `name` | `"set-cookie"` |

#### Returns

`undefined` \| `string`[]

#### Inherited from

Request.header

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:416

▸ **header**(`name`): `undefined` \| `string`

#### Parameters

| Name   | Type     |
| :----- | :------- |
| `name` | `string` |

#### Returns

`undefined` \| `string`

#### Inherited from

Request.header

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:417

---

### is

▸ **is**(`type`): `null` \| `string` \| `false`

Check if the incoming request contains the "Content-Type"
header field, and it contains the give mime `type`.

Examples:

     // With Content-Type: text/html; charset=utf-8
     req.is('html');
     req.is('text/html');
     req.is('text/*');
     // => true

     // When Content-Type is application/json
     req.is('json');
     req.is('application/json');
     req.is('application/*');
     // => true

     req.is('html');
     // => false

#### Parameters

| Name   | Type                   |
| :----- | :--------------------- |
| `type` | `string` \| `string`[] |

#### Returns

`null` \| `string` \| `false`

#### Inherited from

Request.is

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:553

---

### isAuthenticated

▸ **isAuthenticated**(): this is AuthenticatedRequest

Test if request is authenticated.

#### Returns

this is AuthenticatedRequest

#### Inherited from

Request.isAuthenticated

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:64

---

### isPaused

▸ **isPaused**(): `boolean`

The `readable.isPaused()` method returns the current operating state of the`Readable`. This is used primarily by the mechanism that underlies the`readable.pipe()` method. In most
typical cases, there will be no reason to
use this method directly.

```js
const readable = new stream.Readable();

readable.isPaused(); // === false
readable.pause();
readable.isPaused(); // === true
readable.resume();
readable.isPaused(); // === false
```

#### Returns

`boolean`

**`Since`**

v0.11.14

#### Inherited from

Request.isPaused

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:287

---

### isUnauthenticated

▸ **isUnauthenticated**(): this is UnauthenticatedRequest

Test if request is unauthenticated.

#### Returns

this is UnauthenticatedRequest

#### Inherited from

Request.isUnauthenticated

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:68

---

### iterator

▸ **iterator**(`options?`): `AsyncIterableIterator`\<`any`\>

The iterator created by this method gives users the option to cancel the destruction
of the stream if the `for await...of` loop is exited by `return`, `break`, or `throw`,
or if the iterator should destroy the stream if the stream emitted an error during iteration.

#### Parameters

| Name                       | Type      | Description                                                                                                                                                                                  |
| :------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options?`                 | `Object`  | -                                                                                                                                                                                            |
| `options.destroyOnReturn?` | `boolean` | When set to `false`, calling `return` on the async iterator, or exiting a `for await...of` iteration using a `break`, `return`, or `throw` will not destroy the stream. **Default: `true`**. |

#### Returns

`AsyncIterableIterator`\<`any`\>

**`Since`**

v16.3.0

#### Inherited from

Request.iterator

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:417

---

### listenerCount

▸ **listenerCount**\<`K`\>(`eventName`, `listener?`): `number`

Returns the number of listeners listening for the event named `eventName`.
If `listener` is provided, it will return how many times the listener is found
in the list of the listeners of the event.

#### Type parameters

| Name |
| :--- |
| `K`  |

#### Parameters

| Name        | Type                 | Description                              |
| :---------- | :------------------- | :--------------------------------------- |
| `eventName` | `string` \| `symbol` | The name of the event being listened for |
| `listener?` | `Function`           | The event handler function               |

#### Returns

`number`

**`Since`**

v3.2.0

#### Inherited from

Request.listenerCount

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:829

---

### listeners

▸ **listeners**\<`K`\>(`eventName`): `Function`[]

Returns a copy of the array of listeners for the event named `eventName`.

```js
server.on("connection", (stream) => {
    console.log("someone connected!");
});
console.log(util.inspect(server.listeners("connection")));
// Prints: [ [Function] ]
```

#### Type parameters

| Name |
| :--- |
| `K`  |

#### Parameters

| Name        | Type                 |
| :---------- | :------------------- |
| `eventName` | `string` \| `symbol` |

#### Returns

`Function`[]

**`Since`**

v0.1.26

#### Inherited from

Request.listeners

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:748

---

### logIn

▸ **logIn**(`user`, `done`): `void`

Initiate a login session for `user`.

Options:

- `session` Save login state in session, defaults to `true`.

Examples:

    req.logIn(user, { session: false });

    req.logIn(user, function(err) {
      if (err) { throw err; }
      // session saved
    });

#### Parameters

| Name   | Type                     |
| :----- | :----------------------- |
| `user` | `User`                   |
| `done` | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logIn

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:47

▸ **logIn**(`user`, `options`, `done`): `void`

#### Parameters

| Name      | Type                     |
| :-------- | :----------------------- |
| `user`    | `User`                   |
| `options` | `LogInOptions`           |
| `done`    | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logIn

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:48

---

### logOut

▸ **logOut**(`options`, `done`): `void`

Terminate an existing login session.

#### Parameters

| Name      | Type                     |
| :-------- | :----------------------- |
| `options` | `LogOutOptions`          |
| `done`    | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logOut

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:58

▸ **logOut**(`done`): `void`

#### Parameters

| Name   | Type                     |
| :----- | :----------------------- |
| `done` | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logOut

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:59

---

### login

▸ **login**(`user`, `done`): `void`

Initiate a login session for `user`.

Options:

- `session` Save login state in session, defaults to `true`.

Examples:

    req.logIn(user, { session: false });

    req.logIn(user, function(err) {
      if (err) { throw err; }
      // session saved
    });

#### Parameters

| Name   | Type                     |
| :----- | :----------------------- |
| `user` | `User`                   |
| `done` | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.login

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:30

▸ **login**(`user`, `options`, `done`): `void`

#### Parameters

| Name      | Type                     |
| :-------- | :----------------------- |
| `user`    | `User`                   |
| `options` | `LogInOptions`           |
| `done`    | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.login

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:31

---

### logout

▸ **logout**(`options`, `done`): `void`

Terminate an existing login session.

#### Parameters

| Name      | Type                     |
| :-------- | :----------------------- |
| `options` | `LogOutOptions`          |
| `done`    | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logout

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:53

▸ **logout**(`done`): `void`

#### Parameters

| Name   | Type                     |
| :----- | :----------------------- |
| `done` | (`err`: `any`) => `void` |

#### Returns

`void`

#### Inherited from

Request.logout

#### Defined in

composer-service-core/node_modules/@types/passport/index.d.ts:54

---

### map

▸ **map**(`fn`, `options?`): `Readable`

This method allows mapping over the stream. The _fn_ function will be called for every chunk in the stream.
If the _fn_ function returns a promise - that promise will be `await`ed before being passed to the result stream.

#### Parameters

| Name       | Type                                                                       | Description                                                     |
| :--------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `any` | a function to map over every chunk in the stream. Async or not. |
| `options?` | `ArrayOptions`                                                             | -                                                               |

#### Returns

`Readable`

a stream mapped with the function _fn_.

**`Since`**

v17.4.0, v16.14.0

#### Inherited from

Request.map

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:425

---

### off

▸ **off**\<`K`\>(`eventName`, `listener`): `this`

Alias for `emitter.removeListener()`.

#### Type parameters

| Name |
| :--- |
| `K`  |

#### Parameters

| Name        | Type                           |
| :---------- | :----------------------------- |
| `eventName` | `string` \| `symbol`           |
| `listener`  | (...`args`: `any`[]) => `void` |

#### Returns

`this`

**`Since`**

v10.0.0

#### Inherited from

Request.off

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:708

---

### on

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:606

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:607

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:608

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:609

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:610

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:611

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:612

▸ **on**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.on

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:613

---

### once

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:614

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:615

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:616

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:617

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:618

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:619

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:620

▸ **once**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.once

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:621

---

### param

▸ **param**(`name`, `defaultValue?`): `string`

#### Parameters

| Name            | Type     |
| :-------------- | :------- |
| `name`          | `string` |
| `defaultValue?` | `any`    |

#### Returns

`string`

**`Deprecated`**

since 4.11 Use either req.params, req.body or req.query, as applicable.

Return the value of param `name` when present or `defaultValue`.

- Checks route placeholders, ex: _/user/:id_
- Checks body params, ex: id=12, {"id":12}
- Checks query string params, ex: ?id=12

To utilize request bodies, `req.body`
should be an object. This can be done by using
the `connect.bodyParser()` middleware.

#### Inherited from

Request.param

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:530

---

### pause

▸ **pause**(): `this`

The `readable.pause()` method will cause a stream in flowing mode to stop
emitting `'data'` events, switching out of flowing mode. Any data that
becomes available will remain in the internal buffer.

```js
const readable = getReadableStreamSomehow();
readable.on("data", (chunk) => {
    console.log(`Received ${chunk.length} bytes of data.`);
    readable.pause();
    console.log("There will be no additional data for 1 second.");
    setTimeout(() => {
        console.log("Now data will start flowing again.");
        readable.resume();
    }, 1000);
});
```

The `readable.pause()` method has no effect if there is a `'readable'`event listener.

#### Returns

`this`

**`Since`**

v0.9.4

#### Inherited from

Request.pause

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:251

---

### pipe

▸ **pipe**\<`T`\>(`destination`, `options?`): `T`

#### Type parameters

| Name | Type                            |
| :--- | :------------------------------ |
| `T`  | extends `WritableStream`\<`T`\> |

#### Parameters

| Name           | Type      |
| :------------- | :-------- |
| `destination`  | `T`       |
| `options?`     | `Object`  |
| `options.end?` | `boolean` |

#### Returns

`T`

#### Inherited from

Request.pipe

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:29

---

### prependListener

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:622

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:623

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:624

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:625

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:626

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:627

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:628

▸ **prependListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:629

---

### prependOnceListener

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:630

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:631

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:632

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:633

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:634

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:635

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:636

▸ **prependOnceListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.prependOnceListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:637

---

### push

▸ **push**(`chunk`, `encoding?`): `boolean`

#### Parameters

| Name        | Type             |
| :---------- | :--------------- |
| `chunk`     | `any`            |
| `encoding?` | `BufferEncoding` |

#### Returns

`boolean`

#### Inherited from

Request.push

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:407

---

### range

▸ **range**(`size`, `options?`): `undefined` \| `Result` \| `Ranges`

Parse Range header field, capping to the given `size`.

Unspecified ranges such as "0-" require knowledge of your resource length. In
the case of a byte range this is of course the total number of bytes.
If the Range header field is not given `undefined` is returned.
If the Range header field is given, return value is a result of range-parser.
See more ./types/range-parser/index.d.ts

NOTE: remember that ranges are inclusive, so for example "Range: users=0-3"
should respond with 4 users when available, not 3.

#### Parameters

| Name       | Type      |
| :--------- | :-------- |
| `size`     | `number`  |
| `options?` | `Options` |

#### Returns

`undefined` \| `Result` \| `Ranges`

#### Inherited from

Request.range

#### Defined in

composer-core/node_modules/@types/express-serve-static-core/index.d.ts:509

---

### rawListeners

▸ **rawListeners**\<`K`\>(`eventName`): `Function`[]

Returns a copy of the array of listeners for the event named `eventName`,
including any wrappers (such as those created by `.once()`).

```js
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.once("log", () => console.log("log once"));

// Returns a new Array with a function `onceWrapper` which has a property
// `listener` which contains the original listener bound above
const listeners = emitter.rawListeners("log");
const logFnWrapper = listeners[0];

// Logs "log once" to the console and does not unbind the `once` event
logFnWrapper.listener();

// Logs "log once" to the console and removes the listener
logFnWrapper();

emitter.on("log", () => console.log("log persistently"));
// Will return a new Array with a single function bound by `.on()` above
const newListeners = emitter.rawListeners("log");

// Logs "log persistently" twice
newListeners[0]();
emitter.emit("log");
```

#### Type parameters

| Name |
| :--- |
| `K`  |

#### Parameters

| Name        | Type                 |
| :---------- | :------------------- |
| `eventName` | `string` \| `symbol` |

#### Returns

`Function`[]

**`Since`**

v9.4.0

#### Inherited from

Request.rawListeners

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:779

---

### read

▸ **read**(`size?`): `any`

The `readable.read()` method reads data out of the internal buffer and
returns it. If no data is available to be read, `null` is returned. By default,
the data is returned as a `Buffer` object unless an encoding has been
specified using the `readable.setEncoding()` method or the stream is operating
in object mode.

The optional `size` argument specifies a specific number of bytes to read. If`size` bytes are not available to be read, `null` will be returned \_unless_the stream has ended, in which
case all of the data remaining in the internal
buffer will be returned.

If the `size` argument is not specified, all of the data contained in the
internal buffer will be returned.

The `size` argument must be less than or equal to 1 GiB.

The `readable.read()` method should only be called on `Readable` streams
operating in paused mode. In flowing mode, `readable.read()` is called
automatically until the internal buffer is fully drained.

```js
const readable = getReadableStreamSomehow();

// 'readable' may be triggered multiple times as data is buffered in
readable.on("readable", () => {
    let chunk;
    console.log("Stream is readable (new data received in buffer)");
    // Use a loop to make sure we read all currently available data
    while (null !== (chunk = readable.read())) {
        console.log(`Read ${chunk.length} bytes of data...`);
    }
});

// 'end' will be triggered once when there is no more data available
readable.on("end", () => {
    console.log("Reached end of stream.");
});
```

Each call to `readable.read()` returns a chunk of data, or `null`. The chunks
are not concatenated. A `while` loop is necessary to consume all data
currently in the buffer. When reading a large file `.read()` may return `null`,
having consumed all buffered content so far, but there is still more data to
come not yet buffered. In this case a new `'readable'` event will be emitted
when there is more data in the buffer. Finally the `'end'` event will be
emitted when there is no more data to come.

Therefore to read a file's whole contents from a `readable`, it is necessary
to collect chunks across multiple `'readable'` events:

```js
const chunks = [];

readable.on("readable", () => {
    let chunk;
    while (null !== (chunk = readable.read())) {
        chunks.push(chunk);
    }
});

readable.on("end", () => {
    const content = chunks.join("");
});
```

A `Readable` stream in object mode will always return a single item from
a call to `readable.read(size)`, regardless of the value of the`size` argument.

If the `readable.read()` method returns a chunk of data, a `'data'` event will
also be emitted.

Calling [read](RequestWS.md#read) after the `'end'` event has
been emitted will return `null`. No runtime error will be raised.

#### Parameters

| Name    | Type     | Description                                         |
| :------ | :------- | :-------------------------------------------------- |
| `size?` | `number` | Optional argument to specify how much data to read. |

#### Returns

`any`

**`Since`**

v0.9.4

#### Inherited from

Request.read

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:204

---

### reduce

▸ **reduce**\<`T`\>(`fn`, `initial?`, `options?`): `Promise`\<`T`\>

This method calls _fn_ on each chunk of the stream in order, passing it the result from the calculation
on the previous element. It returns a promise for the final value of the reduction.

If no _initial_ value is supplied the first chunk of the stream is used as the initial value.
If the stream is empty, the promise is rejected with a `TypeError` with the `ERR_INVALID_ARGS` code property.

The reducer function iterates the stream element-by-element which means that there is no _concurrency_ parameter
or parallelism. To perform a reduce concurrently, you can extract the async function to `readable.map` method.

#### Type parameters

| Name | Type  |
| :--- | :---- |
| `T`  | `any` |

#### Parameters

| Name       | Type                                                                                        | Description                                                              |
| :--------- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------- |
| `fn`       | (`previous`: `any`, `data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `T` | a reducer function to call over every chunk in the stream. Async or not. |
| `initial?` | `undefined`                                                                                 | the initial value to use in the reduction.                               |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\>                                                        | -                                                                        |

#### Returns

`Promise`\<`T`\>

a promise for the final value of the reduction.

**`Since`**

v17.5.0

#### Inherited from

Request.reduce

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:556

▸ **reduce**\<`T`\>(`fn`, `initial`, `options?`): `Promise`\<`T`\>

#### Type parameters

| Name | Type  |
| :--- | :---- |
| `T`  | `any` |

#### Parameters

| Name       | Type                                                                                      |
| :--------- | :---------------------------------------------------------------------------------------- |
| `fn`       | (`previous`: `T`, `data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `T` |
| `initial`  | `T`                                                                                       |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\>                                                      |

#### Returns

`Promise`\<`T`\>

#### Inherited from

Request.reduce

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:561

---

### removeAllListeners

▸ **removeAllListeners**(`eventName?`): `this`

Removes all listeners, or those of the specified `eventName`.

It is bad practice to remove listeners added elsewhere in the code,
particularly when the `EventEmitter` instance was created by some other
component or module (e.g. sockets or file streams).

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name         | Type                 |
| :----------- | :------------------- |
| `eventName?` | `string` \| `symbol` |

#### Returns

`this`

**`Since`**

v0.1.26

#### Inherited from

Request.removeAllListeners

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:719

---

### removeListener

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"close"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:638

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"data"`                   |
| `listener` | (`chunk`: `any`) => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:639

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"end"`      |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:640

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                       |
| :--------- | :------------------------- |
| `event`    | `"error"`                  |
| `listener` | (`err`: `Error`) => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:641

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"pause"`    |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:642

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"readable"` |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:643

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `event`    | `"resume"`   |
| `listener` | () => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:644

▸ **removeListener**(`event`, `listener`): `this`

#### Parameters

| Name       | Type                           |
| :--------- | :----------------------------- |
| `event`    | `string` \| `symbol`           |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

`this`

#### Inherited from

Request.removeListener

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:645

---

### resume

▸ **resume**(): `this`

The `readable.resume()` method causes an explicitly paused `Readable` stream to
resume emitting `'data'` events, switching the stream into flowing mode.

The `readable.resume()` method can be used to fully consume the data from a
stream without actually processing any of that data:

```js
getReadableStreamSomehow()
    .resume()
    .on("end", () => {
        console.log("Reached the end, but did not read anything.");
    });
```

The `readable.resume()` method has no effect if there is a `'readable'`event listener.

#### Returns

`this`

**`Since`**

v0.9.4

#### Inherited from

Request.resume

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:270

---

### setEncoding

▸ **setEncoding**(`encoding`): `this`

The `readable.setEncoding()` method sets the character encoding for
data read from the `Readable` stream.

By default, no encoding is assigned and stream data will be returned as`Buffer` objects. Setting an encoding causes the stream data
to be returned as strings of the specified encoding rather than as `Buffer`objects. For instance, calling `readable.setEncoding('utf8')` will cause the
output data to be interpreted as UTF-8 data, and passed as strings. Calling`readable.setEncoding('hex')` will cause the data to be encoded in hexadecimal
string format.

The `Readable` stream will properly handle multi-byte characters delivered
through the stream that would otherwise become improperly decoded if simply
pulled from the stream as `Buffer` objects.

```js
const readable = getReadableStreamSomehow();
readable.setEncoding("utf8");
readable.on("data", (chunk) => {
    assert.equal(typeof chunk, "string");
    console.log("Got %d characters of string data:", chunk.length);
});
```

#### Parameters

| Name       | Type             | Description          |
| :--------- | :--------------- | :------------------- |
| `encoding` | `BufferEncoding` | The encoding to use. |

#### Returns

`this`

**`Since`**

v0.9.4

#### Inherited from

Request.setEncoding

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:229

---

### setMaxListeners

▸ **setMaxListeners**(`n`): `this`

By default `EventEmitter`s will print a warning if more than `10` listeners are
added for a particular event. This is a useful default that helps finding
memory leaks. The `emitter.setMaxListeners()` method allows the limit to be
modified for this specific `EventEmitter` instance. The value can be set to`Infinity` (or `0`) to indicate an unlimited number of listeners.

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type     |
| :--- | :------- |
| `n`  | `number` |

#### Returns

`this`

**`Since`**

v0.3.5

#### Inherited from

Request.setMaxListeners

#### Defined in

composer-service-core/node_modules/@types/node/events.d.ts:729

---

### setTimeout

▸ **setTimeout**(`msecs`, `callback?`): `this`

Calls `message.socket.setTimeout(msecs, callback)`.

#### Parameters

| Name        | Type         |
| :---------- | :----------- |
| `msecs`     | `number`     |
| `callback?` | () => `void` |

#### Returns

`this`

**`Since`**

v0.5.9

#### Inherited from

Request.setTimeout

#### Defined in

composer-service-core/node_modules/@types/node/http.d.ts:1288

---

### some

▸ **some**(`fn`, `options?`): `Promise`\<`boolean`\>

This method is similar to `Array.prototype.some` and calls _fn_ on each chunk in the stream
until the awaited return value is `true` (or any truthy value). Once an _fn_ call on a chunk
`await`ed return value is truthy, the stream is destroyed and the promise is fulfilled with `true`.
If none of the _fn_ calls on the chunks return a truthy value, the promise is fulfilled with `false`.

#### Parameters

| Name       | Type                                                                                                     | Description                                                   |
| :--------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `fn`       | (`data`: `any`, `options?`: `Pick`\<`ArrayOptions`, `"signal"`\>) => `boolean` \| `Promise`\<`boolean`\> | a function to call on each chunk of the stream. Async or not. |
| `options?` | `ArrayOptions`                                                                                           | -                                                             |

#### Returns

`Promise`\<`boolean`\>

a promise evaluating to `true` if _fn_ returned a truthy value for at least one of the chunks.

**`Since`**

v17.5.0

#### Inherited from

Request.some

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:475

---

### take

▸ **take**(`limit`, `options?`): `Readable`

This method returns a new stream with the first _limit_ chunks.

#### Parameters

| Name       | Type                                 | Description                                     |
| :--------- | :----------------------------------- | :---------------------------------------------- |
| `limit`    | `number`                             | the number of chunks to take from the readable. |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\> | -                                               |

#### Returns

`Readable`

a stream with _limit_ chunks taken.

**`Since`**

v17.5.0

#### Inherited from

Request.take

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:534

---

### toArray

▸ **toArray**(`options?`): `Promise`\<`any`[]\>

This method allows easily obtaining the contents of a stream.

As this method reads the entire stream into memory, it negates the benefits of streams. It's intended
for interoperability and convenience, not as the primary way to consume streams.

#### Parameters

| Name       | Type                                 |
| :--------- | :----------------------------------- |
| `options?` | `Pick`\<`ArrayOptions`, `"signal"`\> |

#### Returns

`Promise`\<`any`[]\>

a promise containing an array with the contents of the stream.

**`Since`**

v17.5.0

#### Inherited from

Request.toArray

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:465

---

### unpipe

▸ **unpipe**(`destination?`): `this`

The `readable.unpipe()` method detaches a `Writable` stream previously attached
using the [pipe](RequestWS.md#pipe) method.

If the `destination` is not specified, then _all_ pipes are detached.

If the `destination` is specified, but no pipe is set up for it, then
the method does nothing.

```js
const fs = require("node:fs");
const readable = getReadableStreamSomehow();
const writable = fs.createWriteStream("file.txt");
// All the data from readable goes into 'file.txt',
// but only for the first second.
readable.pipe(writable);
setTimeout(() => {
    console.log("Stop writing to file.txt.");
    readable.unpipe(writable);
    console.log("Manually close the file stream.");
    writable.end();
}, 1000);
```

#### Parameters

| Name           | Type             | Description                        |
| :------------- | :--------------- | :--------------------------------- |
| `destination?` | `WritableStream` | Optional specific stream to unpipe |

#### Returns

`this`

**`Since`**

v0.9.4

#### Inherited from

Request.unpipe

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:314

---

### unshift

▸ **unshift**(`chunk`, `encoding?`): `void`

Passing `chunk` as `null` signals the end of the stream (EOF) and behaves the
same as `readable.push(null)`, after which no more data can be written. The EOF
signal is put at the end of the buffer and any buffered data will still be
flushed.

The `readable.unshift()` method pushes a chunk of data back into the internal
buffer. This is useful in certain situations where a stream is being consumed by
code that needs to "un-consume" some amount of data that it has optimistically
pulled out of the source, so that the data can be passed on to some other party.

The `stream.unshift(chunk)` method cannot be called after the `'end'` event
has been emitted or a runtime error will be thrown.

Developers using `stream.unshift()` often should consider switching to
use of a `Transform` stream instead. See the `API for stream implementers` section for more information.

```js
// Pull off a header delimited by \n\n.
// Use unshift() if we get too much.
// Call the callback with (error, header, stream).
const { StringDecoder } = require("node:string_decoder");
function parseHeader(stream, callback) {
    stream.on("error", callback);
    stream.on("readable", onReadable);
    const decoder = new StringDecoder("utf8");
    let header = "";
    function onReadable() {
        let chunk;
        while (null !== (chunk = stream.read())) {
            const str = decoder.write(chunk);
            if (str.includes("\n\n")) {
                // Found the header boundary.
                const split = str.split(/\n\n/);
                header += split.shift();
                const remaining = split.join("\n\n");
                const buf = Buffer.from(remaining, "utf8");
                stream.removeListener("error", callback);
                // Remove the 'readable' listener before unshifting.
                stream.removeListener("readable", onReadable);
                if (buf.length) stream.unshift(buf);
                // Now the body of the message can be read from the stream.
                callback(null, header, stream);
                return;
            }
            // Still reading the header.
            header += str;
        }
    }
}
```

Unlike [push](RequestWS.md#push), `stream.unshift(chunk)` will not
end the reading process by resetting the internal reading state of the stream.
This can cause unexpected results if `readable.unshift()` is called during a
read (i.e. from within a [\_read](RequestWS.md#_read) implementation on a
custom stream). Following the call to `readable.unshift()` with an immediate [push](RequestWS.md#push) will reset the reading state appropriately,
however it is best to simply avoid calling `readable.unshift()` while in the
process of performing a read.

#### Parameters

| Name        | Type             | Description                                                                                                                                                                                                        |
| :---------- | :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk`     | `any`            | Chunk of data to unshift onto the read queue. For streams not operating in object mode, `chunk` must be a string, `Buffer`, `Uint8Array`, or `null`. For object mode streams, `chunk` may be any JavaScript value. |
| `encoding?` | `BufferEncoding` | Encoding of string chunks. Must be a valid `Buffer` encoding, such as `'utf8'` or `'ascii'`.                                                                                                                       |

#### Returns

`void`

**`Since`**

v0.9.11

#### Inherited from

Request.unshift

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:380

---

### wrap

▸ **wrap**(`stream`): `this`

Prior to Node.js 0.10, streams did not implement the entire `node:stream`module API as it is currently defined. (See `Compatibility` for more
information.)

When using an older Node.js library that emits `'data'` events and has a [pause](RequestWS.md#pause) method that is advisory only, the`readable.wrap()` method can be used to create a `Readable`
stream that uses
the old stream as its data source.

It will rarely be necessary to use `readable.wrap()` but the method has been
provided as a convenience for interacting with older Node.js applications and
libraries.

```js
const { OldReader } = require("./old-api-module.js");
const { Readable } = require("node:stream");
const oreader = new OldReader();
const myReader = new Readable().wrap(oreader);

myReader.on("readable", () => {
    myReader.read(); // etc.
});
```

#### Parameters

| Name     | Type             | Description                    |
| :------- | :--------------- | :----------------------------- |
| `stream` | `ReadableStream` | An "old style" readable stream |

#### Returns

`this`

**`Since`**

v0.9.4

#### Inherited from

Request.wrap

#### Defined in

composer-service-core/node_modules/@types/node/stream.d.ts:406
