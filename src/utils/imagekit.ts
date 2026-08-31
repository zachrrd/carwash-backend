import { imagekit } from "../config/imagekit";

export const uploadImageToImageKit = async (
  file: Express.Multer.File,
) => {
  const result = await imagekit.files.upload({
    file: file.buffer.toString("base64"),
    fileName: `${Date.now()}-${file.originalname}`,
    folder: "/services",
  });

  if (!result.url || !result.fileId) {
    throw new Error("ImageKit upload failed: missing file URL or file ID");
  }

  return {
    image_url: result.url,
    image_id: result.fileId,
  };
};

export const deleteImageFromImageKit = async (
  fileId: string,
) => {
  await imagekit.files.delete(fileId);
};