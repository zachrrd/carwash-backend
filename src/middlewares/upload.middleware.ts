import multer from "multer";
import path from "path";

const storage = multer.memoryStorage();

const fileFilter: multer.Options["fileFilter"] = (
  _req,
  file,
  cb,
) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  const allowedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ];

  const extension = path
    .extname(file.originalname)
    .toLowerCase();

  const isValidMime =
    allowedMimeTypes.includes(file.mimetype);

  const isOctetStreamImage =
    file.mimetype === "application/octet-stream" &&
    allowedExtensions.includes(extension);

  if (isValidMime || isOctetStreamImage) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Only JPG, JPEG, PNG, and WEBP images are allowed",
      ),
    );
  }
};

export const uploadServiceImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});