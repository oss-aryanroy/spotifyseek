import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

// slsk-client assumes the existence of /tmp/slsk directory, so need to create it if not already there.
try {
  mkdirSync(join(homedir(), "tmp/slsk"), { recursive: true });
} catch (err) {
  if (err.code !== "EEXIST") throw err;
}

import Server from "./server.js";
let server = new Server();
server.serveExpress();