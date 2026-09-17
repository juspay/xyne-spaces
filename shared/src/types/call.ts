export type CallParticipantMetadata = Record<string, unknown> & {
    removedByHost?: boolean;
}

export type HostControls = {
    turnOffAudio: boolean;
    turnOffCamera: boolean;
    turnOffScreenShare: boolean;
}

export const DEFAULT_HOST_CONTROLS: HostControls = {
    turnOffAudio: false,
    turnOffCamera: false,
    turnOffScreenShare: false,
}
