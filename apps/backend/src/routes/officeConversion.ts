import express from "express"
import { OfficeConversionController } from "../controllers/officeConversionController"
import { officeConversionUpload } from "../middleware/upload"

const router = express.Router()
const officeConversionController = new OfficeConversionController()

// Converts an uploaded office document (pptx, docx, ...) to PDF via LibreOffice.
router.post(
    "/pdf",
    officeConversionUpload.single("file"),
    officeConversionController.convertToPdf,
)

export default router
