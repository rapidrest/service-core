///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level test for SessionManager's defensive `objectFactory` guard, which never triggers in
// Session.test.ts's ObjectFactory-driven integration tests since @Inject always resolves it there.
import { SessionManager } from "../../../src/http/session/SessionManager";

describe("SessionManager Tests (unit)", () => {
    it("throws during init() if objectFactory was never injected", async () => {
        const mgr: any = new SessionManager();
        mgr.objectFactory = undefined;
        mgr.options = {};
        mgr.globalCookieSecret = undefined;
        await expect(mgr.init()).rejects.toThrow("objectFactory is not set.");
    });
});
