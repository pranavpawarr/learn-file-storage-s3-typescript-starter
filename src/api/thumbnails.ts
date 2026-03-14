import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

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
    throw new BadRequestError("Thumbnail must be a file");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file size exceeds 10MB limit");
  }

  const mediaType = thumbnail.type;
  const fileExtension = mediaType.split("/")[1];
  const imageData = await thumbnail.arrayBuffer();

  if (mediaType !== "image/png" && mediaType !== "image/jpeg") {
    throw new BadRequestError("Thumbnail must be a PNG or JPEG");
  }

  const video = await getVideo(cfg.db, videoId);
  if (!video) {
    throw new BadRequestError("Video not found");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("You do not own this video");
  }

  const filePath = path.join(cfg.assetsRoot, `${videoId}.${fileExtension}`);
  await Bun.write(filePath, imageData);

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${fileExtension}`;
  const updatedVideo = { ...video, thumbnailURL };
  await updateVideo(cfg.db, updatedVideo);

  return respondWithJSON(200, updatedVideo);
}
