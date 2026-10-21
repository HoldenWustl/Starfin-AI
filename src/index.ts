import { startServer } from "./server.js";
import { redact } from "./lib/redact.js";
void startServer().catch(error => { console.error(`Starfin startup failed: ${redact(error)}`); process.exitCode = 1; });
