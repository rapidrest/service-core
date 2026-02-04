import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [
        tsconfigPaths({
            projects: ["../tsconfig.test.json"]
        })
    ],
    test: {
        reporters: [
            "verbose",
            ["junit", { outputFile: "junit.xml" }]
        ],
        setupFiles: [
            "./vitest.setup.ts"
        ],
    },
});
