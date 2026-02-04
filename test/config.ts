///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import nconf from "nconf";
const conf = nconf
    .argv()
    .env({
        separator: "__",
        lowerCase: true,
        parseValues: true,
    });

conf.use("memory");

conf.defaults({
    service_name: "api_service",
    version: "1.0",
    cookie_secret: "f0fLSKFJLKWJFe09f32joff098u2fOFIWJ32890fnfnlak",
    cors: {
        origins: ["http://localhost:3000"],
    },
    datastores: {
        acl: {
            type: "mongodb",
            url: "mongodb://localhost:9999/acls",
            synchronize: true,
        },
        mongodb: {
            type: "mongodb",
            host: "localhost",
            port: 9999,
            database: "accounts",
            synchronize: true,
        },
        sqlite: {
            type: "sqlite",
            host: "localhost",
            database: "rrst-test",
            synchronize: true,
        },
    },
    // Specifies the group names that are considered to be trusted with administrative privileges.
    trusted_roles: ["admin"],
    // Settings pertaining to the signing and verification of authentication tokens
    auth: {
        // The default PassportJS authentication strategy to use
        strategy: "passportjs.JWTStrategy",
        // The password to be used when signing or verifying authentication tokens
        secret: "MyPasswordIsSecure",
        options: {
            // "algorithm": "HS256",
            expiresIn: "7 days",
            audience: "mydomain.com",
            issuer: "api.mydomain.com",
        },
    },
    session: {
        secret: "SessionsHaveSecrets",
    },
    cluster_url: "http://localhost",
});

export default conf;
