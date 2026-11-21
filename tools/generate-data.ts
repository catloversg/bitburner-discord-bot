import JSZip from "jszip";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { getRequiredEnv } from "../src/utils.ts";

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
  const nsMarkdownFiles: Record<string, string> = {};
  for (const folder of [STABLE_NS_MARKDOWN_FOLDER, DEV_NS_MARKDOWN_FOLDER]) {
    const isDev = folder === DEV_NS_MARKDOWN_FOLDER;
    for (const key of await readdir(folder)) {
      if (key === "index.md") {
        continue;
      }
      const convertedKey = key.replace(/^bitburner\.|\.md$/g, "");
      if (Object.hasOwn(nsMarkdownFiles, convertedKey)) {
        continue;
      }
      nsMarkdownFiles[convertedKey] =
        `https://github.com/bitburner-official/bitburner-src/blob/${!isDev ? "stable" : "dev"}/markdown/bitburner.${convertedKey}.md`;
    }

    const nsJsonDataOutputPath = new URL("../data/ns-data.json", import.meta.url);
    await writeFile(nsJsonDataOutputPath, JSON.stringify(nsMarkdownFiles, null, 1), "utf-8");
  }
}

async function main() {
  await generateMdnJsonData();
  await generateNsJsonData();
}

main().catch(console.error);
