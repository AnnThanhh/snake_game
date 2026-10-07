import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code ? reject(new Error(`Build failed (${code})`)) : resolve(),
    );
  });
await run("node_modules/typescript/bin/tsc", ["-p", "tsconfig.json"]);
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", {
  recursive: true,
  filter: (source) =>
    source.replaceAll("\\", "/") !== "public/v2" &&
    !source.replaceAll("\\", "/").startsWith("public/v2/"),
});
await run("node_modules/vite/bin/vite.js", [
  "build",
  "--configLoader",
  "native",
]);
