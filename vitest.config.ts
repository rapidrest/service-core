import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
    plugins: [
        swc.vite({
            jsc: {
                parser: {
                    syntax: 'typescript',
                    decorators: true,
                },
                transform: {
                    decoratorMetadata: true,
                    legacyDecorator: true,
                },
                target: 'es2020',
            },
        }),
    ],
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        fileParallelism: false,
        pool: 'forks',
        poolOptions: {
            forks: {
                execArgv: ['--no-experimental-strip-types'],
            },
        },
        server: {
            deps: {
                inline: ['@rapidrest/core'],
            },
        },
        clearMocks: true,
        coverage: {
            enabled: true,
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['**/node_modules/**', '**/test/**'],
            reporter: ['text', 'json', 'html', 'lcov'],
            thresholds: {
                branches: 0,
                functions: 0,
                lines: 0,
                statements: 0,
            },
            reportsDirectory: 'coverage',
        },
        reporters: ['default', 'junit'],
        outputFile: {
            junit: 'junit.xml',
        },
    },
});
