import "reflect-metadata";
import SecureDoc from "./server/models/SecureDoc";

describe("debug readonly2", () => {
    it("checks instance value", () => {
        const doc = new SecureDoc({ name: "x", content: "y" } as any);
        console.log("doc.locked:", doc.locked, typeof doc.locked);
        console.log("own props:", Object.getOwnPropertyNames(doc));
        const doc2 = new SecureDoc();
        console.log("doc2.locked (no arg):", doc2.locked);
    });
});
