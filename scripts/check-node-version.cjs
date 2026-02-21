"use strict";

const REQUIRED_MAJOR = 20;
const version = process.versions.node || "";
const major = Number.parseInt(version.split(".")[0] || "", 10);

if (process.env.ALLOW_UNSUPPORTED_NODE === "1") {
  process.exit(0);
}

if (!Number.isFinite(major) || major !== REQUIRED_MAJOR) {
  process.stderr.write(
    [
      `Unsupported Node.js version: ${version}`,
      `This project is pinned to Node ${REQUIRED_MAJOR}.x for native sqlite compatibility.`,
      "Run: nvm use 20.19.3",
      "If you intentionally want to bypass this check once, set ALLOW_UNSUPPORTED_NODE=1.",
    ].join("\n") + "\n"
  );
  process.exit(1);
}
