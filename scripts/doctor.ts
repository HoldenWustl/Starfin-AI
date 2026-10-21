import { validateStartup } from "../src/config.js";
import { doctor } from "../src/discord/handlers.js";
import { redact } from "../src/lib/redact.js";
try { validateStartup(); const result = await doctor(); console.log(result); if (result.includes("FAILED")) process.exitCode = 1; } catch(error) { console.error(redact(error)); process.exitCode = 1; }
