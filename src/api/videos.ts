import { respondWithJSON } from "./json";
import path from "path";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";
import { unlink } from "fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video for video", videoId, "by user", userID);

  const video = await getVideo(cfg.db, videoId);
  if (!video) {
    throw new BadRequestError("Video not found");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("You do not own this video");
  }

  const formData = await req.formData();
  const videoFile = formData.get("video");

  if (!(videoFile instanceof File)) {
    throw new BadRequestError("Video must be a file");
  }

  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file size exceeds 1GB limit");
  }

  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Video must be an MP4");
  }

  // Write to a temp file on disk
  const tempPath = path.join(
    cfg.filepathRoot,
    `temp-${randomBytes(16).toString("hex")}.mp4`,
  );
  const videoData = await videoFile.arrayBuffer();
  await Bun.write(tempPath, videoData);

  try {
    const aspectRatio = await getVideopAspectRatio(tempPath);
    // Generate S3 key and upload
    const randomName = randomBytes(32).toString("hex");
    const s3Key = `${aspectRatio}/${randomName}.mp4`;

    const s3File = cfg.s3Client.file(s3Key, { bucket: cfg.s3Bucket });
    await s3File.write(Bun.file(tempPath), { type: videoFile.type });

    // Build S3 URL and update DB
    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
    const updatedVideo = { ...video, videoURL };
    await updateVideo(cfg.db, updatedVideo);

    return respondWithJSON(200, updatedVideo);
  } finally {
    // Always clean up temp file
    await unlink(tempPath);
  }
}

export async function getVideopAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn(
    [
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
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const exited = await proc.exited;
  if (exited != 0) {
    throw new Error(`ffprobe error: ${stderrText}`);
  }

  const parsed = JSON.parse(stdoutText);
  const width = parsed.streams[0].width;
  const height = parsed.streams[0].height;

  const ratio = width / height;

  if (Math.floor(ratio * 100) === Math.floor((16 / 9) * 100)) {
    return "landscape";
  } else if (Math.floor(ratio * 100) === Math.floor((9 / 16) * 100)) {
    return "portrait"; // 9:16
  } else {
    return "other";
  }
}
