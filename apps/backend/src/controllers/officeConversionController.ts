import { Request, Response } from "express"
import { logger } from "@/utils/logger"
import { convertToPdf, OfficeConversionError } from "@/services/officeConversionService"

/**
 * Stateless office-document-to-PDF conversion. Deliberately not scoped to a
 * collection/attachment/item — every viewer that needs this (KB file viewer,
 * chat attachment gallery, citation previews) already has the raw file
 * bytes client-side (the same `source: File` contract every FileViewer uses),
 * so there's no reason to require a stored resource's ID or duplicate
 * per-context ACL checks for what is purely a transform, not a data access.
 */
export class OfficeConversionController {
    convertToPdf = async (req: Request, res: Response): Promise<void> => {
        const file = req.file
        if (!file) {
            res.status(400).json({ error: "A file is required", code: "MISSING_FILE" })
            return
        }

        try {
            const pdfBuffer = await convertToPdf(file.buffer, file.originalname)
            res.setHeader("Content-Type", "application/pdf")
            res.setHeader("Content-Length", pdfBuffer.length)
            res.send(pdfBuffer)
        } catch (error) {
            if (error instanceof OfficeConversionError && error.code === "SOFFICE_NOT_FOUND") {
                logger.error("[OfficeConversion] LibreOffice not installed on this host", error)
                res.status(503).json({
                    error: "PDF conversion is not available on this server",
                    code: "CONVERTER_UNAVAILABLE",
                })
                return
            }
            if (error instanceof OfficeConversionError && error.code === "TIMEOUT") {
                res.status(504).json({ error: "Conversion timed out", code: "TIMEOUT" })
                return
            }
            logger.error("[OfficeConversion] Conversion failed", error)
            res.status(500).json({ error: "Failed to convert file", code: "CONVERSION_FAILED" })
        }
    }
}
