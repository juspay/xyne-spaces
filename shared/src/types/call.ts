export type CallParticipantMetadata = Record<string, unknown> & {
    removedByHost?: boolean;
}

export type HostControls = {
    lockMic: boolean;
    lockCamera: boolean;
    lockScreenShare: boolean;
}

export const DEFAULT_HOST_CONTROLS: HostControls = {
    lockMic: false,
    lockCamera: false,
    lockScreenShare: false,
}
