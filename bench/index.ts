///////////////////////////////////////////////////////////////////////////////
// Throughput benchmark for service-core.
//
// Usage:
//   yarn bench              — run once, print results
//   yarn bench:baseline     — run once and save results to bench/baseline.txt
//
// Requires: yarn add -D autocannon tsx (done in package.json)
///////////////////////////////////////////////////////////////////////////////
import autocannon, { type Result } from "autocannon";
import uWS from "uWebSockets.js";
import { HttpRouter } from "../src/http/uWS/Router.js";

const PORT = 13337;
const DURATION_SECONDS = 10;
const CONNECTIONS = 100;

// Minimal router — no databases, no auth, no middleware overhead beyond the framework itself.
const app = new HttpRouter(uWS.App());

app.get("/bench", (_req, res) => {
    res.json({ ok: true });
});

await app.listen("127.0.0.1", PORT);
console.log(`Benchmark server listening on port ${PORT}`);

const result: Result = await new Promise((resolve, reject) => {
    const instance = autocannon(
        {
            url: `http://127.0.0.1:${PORT}/bench`,
            connections: CONNECTIONS,
            duration: DURATION_SECONDS,
        },
        (err, result) => {
            if (err) reject(err);
            else resolve(result);
        },
    );
    autocannon.track(instance, { renderProgressBar: true });
});

app.close();

console.log("\n=== service-core benchmark results ===");
console.log(`Requests/sec  (avg): ${result.requests.average.toFixed(0)}`);
console.log(`Requests/sec  (max): ${result.requests.max}`);
console.log(`Latency p50 (ms):    ${result.latency.p50}`);
console.log(`Latency p99 (ms):    ${result.latency.p99}`);
console.log(`Throughput  (avg):   ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`);
console.log(`Total requests:      ${result.requests.total}`);
