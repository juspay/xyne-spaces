type BaseErrorOpts = {
  message?: string;
  cause?: Error;
  fn?: any;
};
enum VespaDbOp {
  Search = 'Search',
}
enum DbOp {
  Create = 'Create',
  READ = 'Read',
  Update = 'Update',
  Delete = 'Delete',
}

type Op = VespaDbOp | DbOp;
type VespaErrorOpts = BaseErrorOpts & {
  sources: string; // or enum type
  op: Op;
  docId?: string;
};
type VespaErrorOptsSansOp = Omit<VespaErrorOpts, 'op'>;

class VespaError extends Error {
  constructor({ message, sources, op, docId, cause }: VespaErrorOpts) {
    let fullMessage = `${message}: for source ${sources} and op: ${op} cause: ${JSON.stringify(cause)}`;
    if (docId) fullMessage += ` for docId: ${docId}`;
    super(fullMessage);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ErrorDeletingDocuments extends VespaError {
  constructor(errorOpts: VespaErrorOptsSansOp) {
    super({ ...errorOpts, op: DbOp.READ });
    this.name = this.constructor.name;
  }
}

export class ErrorRetrievingDocuments extends VespaError {
  constructor(vespaErrOpts: VespaErrorOptsSansOp) {
    let { message, cause } = vespaErrOpts;
    if (!message) {
      message = 'Error retrieving documents';
    }
    super({ ...vespaErrOpts, message, cause, op: DbOp.READ });
    this.name = this.constructor.name;
  }
}

export class ErrorPerformingSearch extends VespaError {
  constructor(vespaErrOpts: VespaErrorOptsSansOp) {
    super({ ...vespaErrOpts, op: VespaDbOp.Search });
    this.name = this.constructor.name;
  }
}

export class ErrorInsertingDocument extends VespaError {
  constructor(vespaErrOpts: VespaErrorOptsSansOp) {
    let { message, cause } = vespaErrOpts;
    if (!message) {
      message = `Error inserting document`;
    }
    super({ ...vespaErrOpts, message, cause, op: DbOp.Create });
    this.name = this.constructor.name;
  }
}
