import JSZip from "jszip";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const STABLE_NS_MARKDOWN_FOLDER = getRequiredEnv("STABLE_NS_MARKDOWN_FOLDER");
const DEV_NS_MARKDOWN_FOLDER = getRequiredEnv("DEV_NS_MARKDOWN_FOLDER");

async function readMdnRepository(): Promise<string[]> {
  const mdnRepository = new URL("../data/content-main.zip", import.meta.url);
  let zipData: Buffer | ArrayBuffer;

  if (existsSync(mdnRepository)) {
    zipData = await readFile(mdnRepository);
  } else {
    const response = await fetch("https://codeload.github.com/mdn/content/zip/refs/heads/main");
    if (!response.ok) {
      throw new Error(`Failed to download MDN repository: ${response.status} ${response.statusText}`);
    }
    zipData = await response.arrayBuffer();
    await writeFile(mdnRepository, Buffer.from(zipData));
  }
  const zip = await JSZip.loadAsync(zipData);
  return Object.keys(zip.files);
}

async function generateMdnJsonData() {
  const files = await readMdnRepository();
  const mdnJsonData: Record<string, string> = {};
  const MDN_PATH_REGEX = /^content-main\/files\/en-us\/web\/(?:api|javascript\/reference)\/(.+)\/index\.md$/;
  for (const file of files) {
    const match = file.match(MDN_PATH_REGEX);
    if (!match) {
      continue;
    }
    const rawKey = match[1];
    const key = rawKey.startsWith("global_objects/")
      ? rawKey.replace(/^global_objects\//, "").replaceAll("/", ".")
      : rawKey.replaceAll("/", " ");
    const slug = file.slice("content-main/files/en-us".length, -"/index.md".length);
    mdnJsonData[key] = `https://developer.mozilla.org/en-us/docs${slug}`.toLowerCase();
  }

  const mdnJsonDataOutputPath = new URL("../data/mdn-data.json", import.meta.url);
  await writeFile(mdnJsonDataOutputPath, JSON.stringify(mdnJsonData, null, 1), "utf-8");
}

async function generateNsJsonData() {
  const allNsMarkdownFiles: Record<string, string> = {};
  const stableNsMarkdownFiles: Record<string, string> = {};
  const devNsMarkdownFiles: Record<string, string> = {};

  for (const [folder, buildType] of [
    [STABLE_NS_MARKDOWN_FOLDER, "stable"],
    [DEV_NS_MARKDOWN_FOLDER, "dev"],
  ] as const) {
    const nsMarkdownFiles = buildType === "stable" ? stableNsMarkdownFiles : devNsMarkdownFiles;

    for (const key of await readdir(folder)) {
      if (key === "index.md") {
        continue;
      }
      const convertedKey = key.replace(/^bitburner\.|\.md$/g, "");
      const url = `https://github.com/bitburner-official/bitburner-src/blob/${buildType}/markdown/bitburner.${convertedKey}.md`;

      nsMarkdownFiles[convertedKey] = url;

      if (!Object.hasOwn(allNsMarkdownFiles, convertedKey)) {
        allNsMarkdownFiles[convertedKey] = url;
      }
    }
  }

  await writeFile(
    new URL("../data/all-ns-data.json", import.meta.url),
    JSON.stringify(allNsMarkdownFiles, null, 1),
    "utf-8",
  );
  await writeFile(
    new URL("../data/stable-ns-data.json", import.meta.url),
    JSON.stringify(stableNsMarkdownFiles, null, 1),
    "utf-8",
  );
  await writeFile(
    new URL("../data/dev-ns-data.json", import.meta.url),
    JSON.stringify(devNsMarkdownFiles, null, 1),
    "utf-8",
  );
}

async function main() {
  await generateMdnJsonData();
  await generateNsJsonData();
}

main().catch(console.error);
