import { type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import type { ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

// limit 20 MB
const MAX_UPLOAD_SIZE = 20 << 20;

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

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

  const videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("");
  }

  videoThumbnails.set(videoId, { data: imageData, mediaType });

  const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;

  videoMetadata.thumbnailURL = thumbnailURL;

  await updateVideo(cfg.db, videoMetadata);

  const newVideoData = await getVideo(cfg.db, videoId);

  return respondWithJSON(200, newVideoData);
}
