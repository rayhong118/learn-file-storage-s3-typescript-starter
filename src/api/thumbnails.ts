import { type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import type { ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

// limit 20 MB
const MAX_UPLOAD_SIZE = 20 << 20;

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const thumbnail = formData.get("thumbnail");

  if (!(thumbnail instanceof File)) {
    throw new BadRequestError("Invalid image file");
  }

  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Invalid file size");
  }

  const mediaType = thumbnail.type;

  const imageData = await thumbnail.arrayBuffer();
  const fileExtension =
    mediaType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  const dataURL = `${cfg.assetsRoot}/${videoId}.${fileExtension}`;

  Bun.write(dataURL, imageData);

  const videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("");
  }

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${fileExtension}`;

  videoMetadata.thumbnailURL = thumbnailURL;

  await updateVideo(cfg.db, videoMetadata);

  const newVideoData = await getVideo(cfg.db, videoId);

  return respondWithJSON(200, newVideoData);
}
