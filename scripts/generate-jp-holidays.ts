#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseSyukujitsuCsvBuffer } from "./parse-syukujitsu-csv.ts";

const currentYearInJst = (): number =>
  Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric"
    }).format(new Date())
  );

type CliOptions = {
  input: string;
  output: string;
  referenceYear?: number;
};

const parseArgs = (argv: string[]): CliOptions => {
  let input = "";
  let output = resolve("src/data/jp-holidays.json");
  let referenceYear: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      input = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output") {
      output = resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--reference-year") {
      const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(parsed)) {
        throw new Error("--reference-year requires a number");
      }
      referenceYear = parsed;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run generate:jp-holidays -- --input <syukujitsu.csv> [--output src/data/jp-holidays.json] [--reference-year YYYY]`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!input) {
    throw new Error("--input is required");
  }
  return { input, output, referenceYear };
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const buffer = readFileSync(options.input);
  const year = options.referenceYear ?? currentYearInJst();
  const json = parseSyukujitsuCsvBuffer(buffer, year);
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      event: "jp_holidays_generated",
      output: options.output,
      reference_year: year,
      coverage: json.coverage,
      dates_count: json.dates.length
    })
  );
};

main();
