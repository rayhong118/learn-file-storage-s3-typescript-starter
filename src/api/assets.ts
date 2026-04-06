import { existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";

import type { ApiConfig } from "../config";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function getAssetPath(mediaType: string) {
  const base = randomBytes(32);
  const id = base.toString("base64url");
  const ext = mediaTypeToExt(mediaType);
  return id + ext;
}

export function mediaTypeToExt(mediaType: string) {
  const parts = mediaType.split("/");
  if (parts.length !== 2) {
    return ".bin";
  }
  return "." + parts[1];
}

export function getAssetDiskPath(cfg: ApiConfig, assetPath: string) {
  return path.join(cfg.assetsRoot, assetPath);
}

export function getAssetURL(cfg: ApiConfig, key: string) {
  // If we have a valid CloudFront distribution, use it
  if (cfg.s3CfDistribution && cfg.s3CfDistribution !== "TEST") {
    const baseUrl = cfg.s3CfDistribution.endsWith("/")
      ? cfg.s3CfDistribution
      : `${cfg.s3CfDistribution}/`;
    return `${baseUrl}${key}`;
  }

  // Fallback to standard S3 URL
  return `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
}
