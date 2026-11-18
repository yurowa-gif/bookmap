import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  execFileSync(path.resolve(import.meta.dirname, "../../scripts/db-test-setup.sh"), { stdio: "inherit" });
}
