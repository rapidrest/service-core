////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
////////////////////////////////////////////////////////////////////////////////
import type { JWTUser } from "@rapidrest/core";
import type { HttpRequest, HttpResponse } from "../http/types.js";
import type { AuthResult, AuthStrategy } from "./AuthStrategy.js";

/**
 * Configuration for a WebAuthn/Passkey relying party.
 */
export interface PasskeyConfig {
    /** The human-readable name of the relying party, shown to the user by the authenticator UI. */
    rpName: string;
    /** The relying party ID — a valid domain name (no scheme/port), e.g. `"example.com"`. */
    rpID: string;
    /**
     * The exact scheme+host+port expected in the client's `clientDataJSON.origin` (e.g.
     * `"https://example.com"`). May be a list to support multiple valid frontend origins.
     */
    origin: string | string[];
    /**
     * Requested user verification behavior at options-generation time. Set to `"discouraged"` for a
     * 2FA-style flow, `"required"`/`"preferred"` otherwise. Default is `"preferred"`.
     */
    userVerification?: "required" | "preferred" | "discouraged";
    /**
     * Whether user verification is *enforced* at response-verification time. This is a distinct
     * knob from `userVerification` above (which only shapes what's requested from the client).
     * Default is `true`.
     */
    requireUserVerification?: boolean;
    /** How long (in ms) the user has to complete the ceremony. Default is `60000`. */
    timeout?: number;
}

/**
 * The transport hints an authenticator can report supporting. Mirrors `@simplewebauthn/server`'s
 * `AuthenticatorTransportFuture` union without a compile-time dependency on that optional package.
 */
export type PasskeyTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

/**
 * A previously-registered WebAuthn credential as persisted by the consuming application.
 */
export interface StoredPasskeyCredential {
    /** The base64url-encoded credential ID. */
    id: string;
    /** The uid of the user this credential belongs to. */
    uid: string;
    /** The credential's public key, as returned by the registration ceremony. */
    publicKey: Uint8Array;
    /** The last-known signature counter for this credential, used to detect cloned authenticators. */
    counter: number;
    /** The transports the authenticator reported supporting, if any (e.g. `["internal", "hybrid"]`). */
    transports?: PasskeyTransport[];
}

/**
 * Describes the configuration options that can be used to initialize PasskeyStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class PasskeyStrategyOptions {
    /**
     * The relying party configuration to use for this strategy.
     */
    public config: PasskeyConfig;

    constructor(config: PasskeyConfig) {
        this.config = config;
    }

    /**
     * Retrieves a previously-registered credential by its ID. Returns `undefined` if no credential
     * with that ID is known.
     */
    public async getCredentialById(credentialId: string): Promise<StoredPasskeyCredential | undefined> {
        throw new Error("Did you forget to override PasskeyStrategyOptions.getCredentialById?");
    }

    /**
     * Retrieves all credentials registered for the given user. Used to build the `allowCredentials`
     * list when a login ceremony is started with a known user hint.
     */
    public async getCredentials(uid: string): Promise<StoredPasskeyCredential[]> {
        throw new Error("Did you forget to override PasskeyStrategyOptions.getCredentials?");
    }

    /**
     * Persists the updated signature counter for the given credential after a successful
     * authentication. Must be called on every successful login to guard against cloned authenticators.
     */
    public async updateCredentialCounter(credentialId: string, newCounter: number): Promise<void> {
        throw new Error("Did you forget to override PasskeyStrategyOptions.updateCredentialCounter?");
    }

    /** Override this function to handle asynchronous (non-blocking) verification of the login info. */
    public verify(uid: string): JWTUser | Promise<JWTUser | undefined> | undefined {
        throw new Error("Did you forget to override PasskeyStrategyOptions.verify?");
    }
}

/**
 * Implements an authentication strategy for performing WebAuthn/Passkey login. This strategy proves
 * possession of an *already-registered* passkey — it does not perform credential registration/enrollment,
 * which is a separate concern (typically gated behind an existing authenticated session via a different
 * strategy) not handled here.
 *
 * The login flow has two phases, both handled by `authenticate()`:
 *
 * 1. Begin: the client requests a challenge. A random challenge is generated and stored in the
 * session, and the resulting options are returned directly to the client for use with
 * `navigator.credentials.get()`.
 * 2. Finish: the client submits the signed assertion response. The response is verified against the
 * stored challenge and the credential's public key, the credential's signature counter is updated,
 * and the associated user is resolved via `verify()`.
 *
 * Requires session support (see `SessionManager`/the `session` config block) — the ceremony challenge
 * is stored server-side in `req.session` between the two requests above.
 *
 * Like `OAuthStrategy`, this strategy is intended to be mounted standalone on its own route. Chaining
 * it as one of several alternates in a multi-strategy `@Auth([...])` list would mean any request that
 * doesn't look like a finish attempt unconditionally starts a new ceremony and writes to `res`, which
 * is very likely not what's wanted in that context.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class PasskeyStrategy implements AuthStrategy {
    public readonly name: string = "passkey";
    private options: PasskeyStrategyOptions;

    constructor(options: PasskeyStrategyOptions) {
        this.options = options;
    }

    public async authenticate(
        req: HttpRequest,
        res: HttpResponse,
        required?: boolean,
    ): Promise<AuthResult | undefined> {
        // Loose gate: anything that looks like an attempt at the finish phase routes there, where it
        // gets strictly shape-validated and cleanly rejected if malformed — rather than silently
        // falling through to the begin phase and producing a confusing response to a bad finish
        // attempt.
        const looksLikeFinish: boolean = req.body?.id !== undefined || req.body?.response !== undefined;
        return looksLikeFinish
            ? await this.finishAuthentication(req, required)
            : await this.beginAuthentication(req, res);
    }

    public authenticateSync(req: HttpRequest, res: HttpResponse, required?: boolean): AuthResult | undefined {
        throw new Error("Not supported. This auth strategy requires must be used asynchronously.");
    }

    /**
     * Begins a login ceremony: generates a challenge, stores it in the session, and writes the
     * resulting options directly to the response for the client to pass to `navigator.credentials.get()`.
     *
     * @param req The source HTTP request. May optionally carry a `uid` query parameter to scope the
     * allowed credentials to a known user; omitted entirely for a discoverable/"usernameless" flow.
     * @param res The response to write the generated options to.
     */
    protected async beginAuthentication(req: HttpRequest, res: HttpResponse): Promise<undefined> {
        if (!req.session) {
            throw new Error(
                "PasskeyStrategy requires session support. Configure the `session` config block so the " +
                    "session middleware is registered.",
            );
        }
        if (!res) {
            throw new Error("PasskeyStrategy requires a response object to begin a ceremony.");
        }

        const config = this.options.config;

        // If a uid hint is given, scope allowCredentials to that user's registered credentials. If
        // the hint resolves to zero credentials, allowCredentials is left undefined (same as the
        // no-hint case) rather than sent as an empty list — otherwise the response shape would leak
        // whether a given uid has any passkeys registered, a user-enumeration side channel.
        // NOTE: scoping allowCredentials to a uid hint necessarily discloses to an unauthenticated
        // caller whether the given uid has any registered passkeys (and their credential IDs/
        // transports) — the same trade-off inherent to any "enter your username first" login flow.
        // Only the zero-credential case is equalized with the no-hint case below (both leave
        // allowCredentials undefined), so a nonexistent/passkey-less account can't be trivially
        // distinguished from one with zero credentials; an account that DOES have credentials
        // remains distinguishable from one that doesn't by design. Callers that need to avoid this
        // entirely (e.g. a public-facing login form) should not wire a client-suppliable uid hint
        // through to this endpoint at all — rely purely on the discoverable/"usernameless" flow by
        // omitting the hint, and consider rate-limiting this endpoint regardless.
        const uidHint: string | undefined = req.query?.uid as string | undefined;
        let allowCredentials: { id: string; transports?: PasskeyTransport[] }[] | undefined = undefined;
        if (uidHint) {
            const credentials: StoredPasskeyCredential[] = await this.options.getCredentials(uidHint);
            if (credentials.length > 0) {
                allowCredentials = credentials.map((c) => ({ id: c.id, transports: c.transports }));
            }
        }

        const { generateAuthenticationOptions } = await this.importSimpleWebAuthn();
        const genOptions = await generateAuthenticationOptions({
            rpID: config.rpID,
            allowCredentials,
            userVerification: config.userVerification,
            timeout: config.timeout,
        });

        req.session.challenge = genOptions.challenge;

        res.status(200);
        res.json(genOptions);
        return undefined;
    }

    /**
     * Finishes a login ceremony: verifies the client-submitted assertion response against the
     * stored challenge and credential, updates the credential's signature counter, and resolves the
     * associated user.
     *
     * @param req The source HTTP request, carrying the assertion response in its body.
     * @param required Set to `true` if authentication is required to pass, otherwise set to `false`.
     */
    protected async finishAuthentication(req: HttpRequest, required?: boolean): Promise<AuthResult | undefined> {
        if (!req.session) {
            throw new Error(
                "PasskeyStrategy requires session support. Configure the `session` config block so the " +
                    "session middleware is registered.",
            );
        }
        if (!req.session.challenge) {
            throw new Error("No passkey ceremony in progress for this session.");
        }
        // The challenge is single-use regardless of outcome — cleared as soon as it's read, before
        // verification is even attempted, rather than only on the success path.
        const expectedChallenge: string = req.session.challenge;
        delete req.session.challenge;

        const body: any = req.body;

        // Strict shape validation before touching storage or SimpleWebAuthn — a malformed finish
        // attempt should fail with a clean, actionable error rather than crashing deep inside the
        // verification library with a confusing low-level error. This alone doesn't reveal whether
        // any particular account/credential exists, so it's kept distinct from the generic failure
        // message below.
        if (
            typeof body?.id !== "string" ||
            typeof body?.response?.clientDataJSON !== "string" ||
            typeof body?.response?.authenticatorData !== "string" ||
            typeof body?.response?.signature !== "string"
        ) {
            throw new Error("Malformed passkey authentication response.");
        }

        // Every failure from here on is reported with the same generic message, regardless of
        // whether the credential ID is unknown, the signature failed to verify, the counter
        // regressed, or the resolved user was rejected by verify() — distinguishing between these
        // would let a caller enumerate which credential IDs/accounts are registered on this server.
        const genericFailure = (): Error => new Error("Passkey authentication failed.");

        const credential: StoredPasskeyCredential | undefined = await this.options.getCredentialById(body.id);
        if (!credential) {
            throw genericFailure();
        }
        if (!Number.isFinite(credential.counter)) {
            throw new Error("Stored passkey credential has an invalid counter.");
        }

        const config = this.options.config;
        const { verifyAuthenticationResponse } = await this.importSimpleWebAuthn();
        const result = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID,
            credential: {
                id: credential.id,
                counter: credential.counter,
                publicKey: credential.publicKey,
                transports: credential.transports,
            },
            requireUserVerification: config.requireUserVerification ?? true,
        });

        if (!result.verified) {
            throw genericFailure();
        }

        // Counter regression check. SimpleWebAuthn deliberately does not enforce counter monotonicity
        // itself (many multi-device/backed-up passkeys always report 0 and would otherwise be
        // permanently locked out) — a non-zero counter that fails to exceed the stored value is the
        // signal of a cloned authenticator per the WebAuthn spec's guidance.
        const newCounter: number = result.authenticationInfo.newCounter;
        if (newCounter !== 0 && newCounter <= credential.counter) {
            throw genericFailure();
        }
        await this.options.updateCredentialCounter(credential.id, newCounter);

        const user: JWTUser | undefined = await this.options.verify(credential.uid);
        if (user) {
            return {
                data: body,
                method: this.name,
                payload: result.authenticationInfo,
                user,
            };
        }

        if (required) {
            throw genericFailure();
        }
        return undefined;
    }

    /**
     * Dynamically imports the optional peer dependency `@simplewebauthn/server`, throwing a helpful
     * error if it is not installed.
     */
    private async importSimpleWebAuthn(): Promise<any> {
        try {
            return await import("@simplewebauthn/server");
        } catch (err: any) {
            throw new Error(
                "PasskeyStrategy requires the optional peer dependency '@simplewebauthn/server'. Install it with: " +
                    "yarn add @simplewebauthn/server",
            );
        }
    }
}
