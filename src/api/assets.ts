import { existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import type { ApiConfig } from "../config";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function getAssetPath(mediaType: string): string {
  const ext = mediaType.split("/")[1];
  const randomName = randomBytes(32).toString("base64url");
  return `${randomName}.${ext}`;
}

export function getAssetDiskPath(cfg: ApiConfig, assetPath: string): string {
  return path.join(cfg.assetsRoot, assetPath);
}

export function getAssetURL(cfg: ApiConfig, assetPath: string): string {
  return `http://localhost:${cfg.port}/assets/${assetPath}`;
}
