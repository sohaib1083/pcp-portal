import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Storage adapter. The demo writes to local disk; production can switch to S3-compatible storage
// with the same keys: institutions/<PCP-UNI-ID>/<folder>/v<version>-<file>.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");

export const DEFAULT_FOLDERS = [
  "legal-documents",
  "university-documents",
  "noc-applications",
  "accreditation",
  "inspection-reports",
  "faculty-documents",
  "student-documents",
  "correspondence",
];

export function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
}

export async function putFile(institutionCode: string, folder: string, version: number, fileName: string, bytes: Buffer) {
  const cleanFolder = folder
    .split("/")
    .map((p) => p.replace(/[^A-Za-z0-9._-]+/g, "-"))
    .filter((p) => p && p !== "..")
    .join("/");
  const key = `institutions/${institutionCode}/${cleanFolder}/v${version}-${safeName(fileName)}`;
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { key, sha256, folder: cleanFolder };
}

export async function getFile(key: string) {
  const full = path.join(ROOT, key);
  if (!full.startsWith(ROOT)) throw new Error("Bad key");
  return readFile(full);
}
