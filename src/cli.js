import { validateBook } from "./book.js";

const command = process.argv[2];
if (command === "validate") {
  const result = await validateBook();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} else {
  console.error("Usage: node src/cli.js validate");
  process.exitCode = 2;
}
