export type UploadErrorCode =
  | 'INVALID_PARENT'
  | 'STORAGE_WRITE_FAILED'
  | 'DB_CREATE_FAILED'
  | 'ADMISSION_FAILED'

export class IngestionUploadError extends Error {
  readonly code: UploadErrorCode
  readonly statusCode: 400 | 500

  constructor(code: UploadErrorCode, message: string, statusCode: 400 | 500 = 500) {
    super(message)
    this.name = 'IngestionUploadError'
    this.code = code
    this.statusCode = statusCode
  }
}
