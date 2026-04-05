import { unlink } from "node:fs/promises";
import { respondWithJSON } from "./json";

import { type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, getAssetPath, getS3AssetURL } from "./assets";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

// limit 1GB
const MAX_UPLOAD_SIZE = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `Video file exceeds the maximum allowed size of 1GB`,
    );
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 allowed.");
  }

  const assetPath = getAssetPath(mediaType);
  const assetDiskPath = getAssetDiskPath(cfg, assetPath);
  await Bun.write(assetDiskPath, file);

  const s3file = cfg.s3Client.file(assetPath);

  await s3file.write(file);

  video.videoURL = getS3AssetURL(cfg, assetPath);
  updateVideo(cfg.db, video);

  await unlink(assetDiskPath);

  return respondWithJSON(200, null);
}
