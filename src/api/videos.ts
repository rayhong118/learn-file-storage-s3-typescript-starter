import { rm } from "node:fs/promises";
import { respondWithJSON } from "./json";

import { type BunRequest } from "bun";
import path from "node:path";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { generatePresignedURL, uploadVideoToS3 } from "../s3";
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

  const processedFilePath = await processVideoForFastStart(tempFilePath);

  const videoAspectRatio = await getVideoAspectRatio(processedFilePath);

  let key = `${videoAspectRatio}${videoId}.mp4`;
  await uploadVideoToS3(cfg, key, processedFilePath, "video/mp4");

  video.videoURL = key;
  updateVideo(cfg.db, video);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(processedFilePath, { force: true }),
  ]);

  const signedVideo = dbVideoToSignedVideo(cfg, video);

  return respondWithJSON(200, signedVideo);
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

export async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed";

  const cmd = [
    "ffmpeg",
    "-i",
    inputFilePath,
    "-movflags",
    "faststart",
    "-map_metadata",
    "0",
    "-codec",
    "copy",
    "-f",
    "mp4",
    outputFilePath,
  ];
  const { exited } = Bun.spawn(cmd);
  const exitCode = await exited;
  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg faststart process failed with exit code ${exitCode}`,
    );
  }

  return outputFilePath;
}

export function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  const videoURL = video.videoURL;
  if (!videoURL) {
    throw new Error("Video URL invalid");
  }
  const signedVidelURL = generatePresignedURL(cfg, videoURL, 100000);

  video.videoURL = signedVidelURL;
  return video;
}
