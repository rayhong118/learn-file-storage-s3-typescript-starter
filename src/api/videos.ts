import { rm } from "node:fs/promises";
import { respondWithJSON } from "./json";

import { type BunRequest } from "bun";
import path from "node:path";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { uploadVideoToS3 } from "../s3";
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

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);

  const videoAspectRatio = await getVideoAspectRatio(tempFilePath);

  let key = `${videoAspectRatio}${videoId}.mp4`;
  await uploadVideoToS3(cfg, key, tempFilePath, "video/mp4");

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string) {
  const cmd = [
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ];

  const { stdout, stderr, exited } = Bun.spawn(cmd);
  const stdoutText = await new Response(stdout).text();
  const exitedResult = await exited;
  if (exitedResult !== 0) {
    const stderrText = await new Response(stderr).text();
    throw new Error(`ffprobe failed: ${stderrText}`);
  }

  const stdoutJson = JSON.parse(stdoutText);

  // Extract width and height from the streams array
  const width = stdoutJson.streams[0].width;
  const height = stdoutJson.streams[0].height;

  return getRatioType(width, height);
}

function getRatioType(width: number, height: number): string {
  if (Math.floor(width / 16) == Math.floor(height / 9)) {
    return "landscape/";
  }
  if (Math.floor(width / 9) == Math.floor(height / 16)) {
    return "portrait/";
  }

  return "other";
}
